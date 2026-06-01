import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";
import { type ObjectStore } from "@/application/ports/object-store";
import { type LocalSnapshotSink } from "@/application/ports/local-snapshot-sink";
import { type FeedCacheInvalidator } from "@/application/ports/feed-cache-invalidator";
import {
  type CompileInput,
  type CompileResult,
} from "@/worker/jobs/compile-feeds";

/**
 * RefreshSupplyFeeds — the supply-feed refresh orchestrator, as a scheduled
 * use-case.
 *
 * For each vendor: pull the curated payload and write it to R2 at two keys:
 *   - supplies/<vendor>/current.json       (overwritten each run)
 *   - supplies/<vendor>/archive/<YYYY-MM-DD>.json  (day granularity, same-day reruns overwrite)
 *
 * Then, once all vendor pulls settle, the compile step reads every known
 * vendor's `current.json` back from R2 (not in-memory) and hands them to
 * `compileFeeds`, which produces three derived feeds:
 *   - supplies/products/current.json  — one entry per real-world thread
 *   - supplies/listings/current.json  — flat per (product × shopping_source)
 *   - supplies/listings/current.csv   — CSV mirror of listings.json
 *
 * R2-sourced compile input means derived feeds stay comprehensive across
 * partial failures: a vendor that failed this run, is paused entirely, or
 * is broken for weeks still contributes its last successful snapshot to the
 * compile output. Only vendors that have literally never run are absent.
 *
 * Derived feeds have no dated archive (per-vendor archives are the source of
 * truth for history; a re-compile against past archives regenerates them).
 *
 * In dev each `current.*` is also dropped on local disk at `data/<same-key>`
 * for quick inspection — the dev-gating lives in the {@link LocalSnapshotSink}
 * adapter, not here, so this use-case stays env-agnostic.
 *
 * Vendors run in parallel (`Promise.allSettled`) so a slow vendor doesn't
 * hold up the others, and a failure in one vendor doesn't block others from
 * archiving or compiling.
 *
 * Mutual exclusion: both the 12h cron and the manual refresh endpoint drive
 * this. A closure-captured flag rejects overlapping runs with
 * `{ status: "busy" }` so a long pull can't be stomped on by a second trigger.
 * The use-case is composed as a process-wide singleton, so the flag is
 * process-wide — matching the old module-level boolean. In-process only — fine
 * for a single Railway replica; revisit if we ever scale horizontally.
 */

export type RefreshResult = { status: "ok" } | { status: "busy" };

export interface RefreshSupplyFeedsDeps {
  /**
   * The active vendor sources, in the behavior-bearing order the composition
   * fixes. `Promise.allSettled` outcomes are mapped back to vendors
   * positionally and the `onlyVendor` filter walks this same list.
   */
  sources: SupplyFeedSource[];
  /** R2 blob store — vendor archives + the derived feeds. */
  objectStore: ObjectStore;
  /** Dev-only on-disk mirror of each `current.*` blob. */
  snapshotSink: LocalSnapshotSink;
  /** Drops the in-process feed-reader cache at the end of a run. */
  feedCache: FeedCacheInvalidator;
  /**
   * The pure-ish cross-vendor compiler (`compileFeeds`). Injected as a function
   * dep so the use-case test can fake it; composition passes the real one.
   */
  compile: (input: CompileInput) => CompileResult;
  /**
   * Every wired vendor name — the compile step reads each one's `current.json`
   * back from R2. Must match `compile-feeds.VENDOR_NAMES`.
   */
  vendorNames: readonly string[];
}

export interface RefreshSupplyFeeds {
  execute(options?: {
    skipPulls?: boolean;
    onlyVendor?: string;
  }): Promise<RefreshResult>;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createRefreshSupplyFeeds(
  deps: RefreshSupplyFeedsDeps,
): RefreshSupplyFeeds {
  const { sources, objectStore, snapshotSink, feedCache, compile, vendorNames } =
    deps;

  // Process-wide mutual-exclusion flag — the closure analog of the old
  // module-level `isRunning` boolean (the use-case is a composition singleton).
  let isRunning = false;

  async function archiveVendor<T>(
    vendor: string,
    pull: () => Promise<T>,
  ): Promise<void> {
    const result = await pull();
    const bytes = new TextEncoder().encode(JSON.stringify(result));

    const currentKey = `supplies/${vendor}/current.json`;
    const archiveKey = `supplies/${vendor}/archive/${todayKey()}.json`;

    await Promise.all([
      objectStore.upload(currentKey, bytes, "application/json"),
      objectStore.upload(archiveKey, bytes, "application/json"),
      snapshotSink.write(`data/${currentKey}`, bytes),
    ]);

    console.log(
      `[refresh-embroidery-supplies] ${vendor} → ${currentKey}, ${archiveKey} (${bytes.byteLength} bytes)`,
    );
  }

  /**
   * Build the compile input by fetching each known vendor's `current.json`
   * from R2. Vendors that just ran successfully will return fresh data
   * (R2 is strongly consistent read-after-write). Vendors that failed this
   * run — or are paused entirely — fall back to their last-archived snapshot.
   * Vendors that have never run return `null` and are skipped.
   */
  async function loadCompileInputFromR2(): Promise<CompileInput> {
    const input: CompileInput = {};
    await Promise.all(
      vendorNames.map(async (name) => {
        const key = `supplies/${name}/current.json`;
        try {
          const bytes = await objectStore.download(key);
          if (!bytes) {
            console.log(
              `[refresh-embroidery-supplies] ${name}: no R2 snapshot — skipping in compile`,
            );
            return;
          }
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          (input as Record<string, unknown>)[name] = parsed;
        } catch (err) {
          console.error(
            `[refresh-embroidery-supplies] ${name}: failed to load from R2 —`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
    return input;
  }

  async function archiveDerived(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await Promise.all([
      objectStore.upload(key, bytes, contentType),
      snapshotSink.write(`data/${key}`, bytes),
    ]);
    console.log(
      `[refresh-embroidery-supplies] → ${key} (${bytes.byteLength} bytes)`,
    );
  }

  return {
    async execute(options = {}) {
      if (isRunning) {
        console.log("[refresh-embroidery-supplies] already running — skipping");
        return { status: "busy" };
      }

      const { skipPulls = false, onlyVendor } = options;

      // Narrow the vendor list when `onlyVendor` is set. Ignored when skipPulls
      // is also set (compile-only mode doesn't pull anything).
      const vendorsToPull = skipPulls
        ? []
        : onlyVendor
          ? sources.filter((v) => v.name === onlyVendor)
          : sources;

      isRunning = true;
      try {
        if (skipPulls) {
          console.log(
            "[refresh-embroidery-supplies] skipPulls=true — compile-only run, reusing R2 snapshots",
          );
        } else if (onlyVendor) {
          if (vendorsToPull.length === 0) {
            console.error(
              `[refresh-embroidery-supplies] onlyVendor='${onlyVendor}' doesn't match any wired vendor`,
            );
            return { status: "ok" };
          }
          console.log(
            `[refresh-embroidery-supplies] onlyVendor='${onlyVendor}' — pulling just this one, compile will use R2 snapshots for the rest`,
          );
        } else if (sources.length === 0) {
          console.log(
            "[refresh-embroidery-supplies] no vendors configured — recompiling derived feeds from existing R2 snapshots",
          );
        }

        const outcomes: PromiseSettledResult<void>[] =
          vendorsToPull.length === 0
            ? []
            : await Promise.allSettled(
                vendorsToPull.map((v) =>
                  archiveVendor(v.name, () => v.pull()),
                ),
              );

        const failures: string[] = [];
        outcomes.forEach((outcome, i) => {
          if (outcome.status === "rejected") {
            const vendor = vendorsToPull[i].name;
            failures.push(vendor);
            console.error(
              `[refresh-embroidery-supplies] ${vendor} failed:`,
              outcome.reason instanceof Error
                ? outcome.reason.message
                : outcome.reason,
            );
          }
        });

        // Only throw if we *attempted* pulls and every single one failed.
        // onlyVendor/compile-only paths skip this check.
        if (
          !skipPulls &&
          vendorsToPull.length > 0 &&
          failures.length === vendorsToPull.length
        ) {
          throw new Error(`all vendors failed: ${failures.join(", ")}`);
        }

        // Compile derived feeds over the latest snapshot of every known vendor,
        // not just the ones that ran this cycle. Vendors that just succeeded
        // return fresh data; vendors that failed or are paused fall back to
        // their last-archived R2 snapshot.
        const compileInput = await loadCompileInputFromR2();
        const { products, listings, listingsCsv } = compile(compileInput);
        const productsBytes = new TextEncoder().encode(
          JSON.stringify(products),
        );
        const listingsBytes = new TextEncoder().encode(
          JSON.stringify(listings),
        );
        const csvBytes = new TextEncoder().encode(listingsCsv);

        await Promise.all([
          archiveDerived(
            "supplies/products/current.json",
            productsBytes,
            "application/json",
          ),
          archiveDerived(
            "supplies/listings/current.json",
            listingsBytes,
            "application/json",
          ),
          archiveDerived(
            "supplies/listings/current.csv",
            csvBytes,
            "text/csv",
          ),
        ]);

        // Drop the in-process feed cache so the next API call reloads the
        // freshly-uploaded R2 data instead of serving the pre-refresh snapshot
        // for up to CACHE_TTL_MS (10 min).
        feedCache.invalidate();

        return { status: "ok" };
      } finally {
        isRunning = false;
      }
    },
  };
}

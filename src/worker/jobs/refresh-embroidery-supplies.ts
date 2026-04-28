/**
 * Refresh embroidery supply feeds.
 *
 * For each vendor: pull the curated payload and write it to R2 at two keys:
 *   - supplies/<vendor>/current.json       (overwritten each run)
 *   - supplies/<vendor>/archive/<YYYY-MM-DD>.json  (day granularity, same-day reruns overwrite)
 *
 * Then, once all vendor pulls settle, the compile step reads every known
 * vendor's `current.json` back from R2 (not in-memory) and hands them to
 * `compileFeeds`, which produces three derived feeds keyed by `"<brand>|<color>"`:
 *   - supplies/details/current.json  — nested per-vendor detail bundle
 *   - supplies/pricing/current.json  — flat price/cost/qty columns per vendor
 *   - supplies/pricing/current.csv   — CSV mirror of pricing.json for tabular use
 *
 * R2-sourced compile input means derived feeds stay comprehensive across
 * partial failures: a vendor that failed this run, is paused entirely, or
 * is broken for weeks still contributes its last successful snapshot to the
 * compile output. Only vendors that have literally never run are absent.
 *
 * Derived feeds have no dated archive (per-vendor archives are the source of
 * truth for history; a re-compile against past archives regenerates them).
 *
 * In dev (`NODE_ENV === "development"`) each `current.*` is also dropped on
 * local disk at `data/<same-key>` for quick inspection. `/data` is gitignored
 * and dockerignored, so this is safe to leave enabled.
 *
 * Vendors run in parallel (`Promise.allSettled`) so a slow vendor doesn't
 * hold up the others, and a failure in one vendor doesn't block others from
 * archiving or compiling.
 *
 * Mutual exclusion: both the 12h cron and the manual refresh endpoint call
 * this function. An in-process flag rejects overlapping runs with
 * `{ status: "busy" }` so a long pull can't be stomped on by a second trigger.
 * In-process only — fine for a single Railway replica; revisit if we ever
 * scale horizontally.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { downloadFromR2, uploadToR2 } from "@/lib/r2";
import { invalidateFeedCache } from "@/lib/ai/embroidery-supplies/feeds";
import { pullGunnold } from "./sources/gunnold-pull";
import { pullSulky } from "./sources/sulky-pull";
import { pullAllstitch } from "./sources/allstitch-pull";
import { pullMadeirausa } from "./sources/madeirausa-pull";
import { pullHabanddash } from "./sources/habanddash-pull";
import { pullColdesi } from "./sources/coldesi-pull";
import { pullThreadart } from "./sources/threadart-pull";
import { pullOhmycrafty } from "./sources/ohmycrafty-pull";
import {
  VENDOR_NAMES,
  compileFeeds,
  type CompileInput,
  type VendorName,
} from "./compile-feeds";

export type RefreshResult = { status: "ok" } | { status: "busy" };

let isRunning = false;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function writeLocalDevSnapshot(
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  const path = join(process.cwd(), relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  console.log(`[refresh-embroidery-supplies] wrote local dev snapshot: ${path}`);
}

async function archiveVendor<T>(
  vendor: string,
  pull: () => Promise<T>,
): Promise<void> {
  const result = await pull();
  const bytes = new TextEncoder().encode(JSON.stringify(result));

  const currentKey = `supplies/${vendor}/current.json`;
  const archiveKey = `supplies/${vendor}/archive/${todayKey()}.json`;

  await Promise.all([
    uploadToR2(currentKey, bytes, "application/json"),
    uploadToR2(archiveKey, bytes, "application/json"),
    writeLocalDevSnapshot(`data/${currentKey}`, bytes),
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
    VENDOR_NAMES.map(async (name: VendorName) => {
      const key = `supplies/${name}/current.json`;
      try {
        const bytes = await downloadFromR2(key);
        if (!bytes) {
          console.log(`[refresh-embroidery-supplies] ${name}: no R2 snapshot — skipping in compile`);
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
    uploadToR2(key, bytes, contentType),
    writeLocalDevSnapshot(`data/${key}`, bytes),
  ]);
  console.log(
    `[refresh-embroidery-supplies] → ${key} (${bytes.byteLength} bytes)`,
  );
}


const VENDORS: Array<{ name: string; pull: () => Promise<unknown> }> = [
  { name: "gunnold", pull: pullGunnold },
  { name: "sulky", pull: pullSulky },
  { name: "allstitch", pull: pullAllstitch },
  // Hab+Dash price data is auth-gated behind Magento's customer-group
  // pricing; set HABANDDASH_EMAIL + HABANDDASH_PASSWORD in env to unlock.
  // Runs anonymous (all prices null) without creds.
  { name: "habanddash", pull: pullHabanddash },
  { name: "coldesi", pull: pullColdesi },
  { name: "threadart", pull: pullThreadart },
  { name: "ohmycrafty", pull: pullOhmycrafty },
  // TODO: implement HTML scraper — see madeirausa-pull.ts header for details.
  // { name: "madeirausa", pull: pullMadeirausa },
];

export async function runRefreshEmbroiderySupplies(
  options: { skipPulls?: boolean; onlyVendor?: string } = {},
): Promise<RefreshResult> {
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
      ? VENDORS.filter((v) => v.name === onlyVendor)
      : VENDORS;

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
    } else if (VENDORS.length === 0) {
      console.log(
        "[refresh-embroidery-supplies] no vendors configured — recompiling derived feeds from existing R2 snapshots",
      );
    }

    const outcomes: PromiseSettledResult<void>[] =
      vendorsToPull.length === 0
        ? []
        : await Promise.allSettled(
            vendorsToPull.map(({ name, pull }) => archiveVendor(name, pull)),
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
    const { products, listings, listingsCsv } = compileFeeds(compileInput);
    const productsBytes = new TextEncoder().encode(JSON.stringify(products));
    const listingsBytes = new TextEncoder().encode(JSON.stringify(listings));
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
      archiveDerived("supplies/listings/current.csv", csvBytes, "text/csv"),
    ]);

    // Drop the in-process feed cache so the next API call reloads the
    // freshly-uploaded R2 data instead of serving the pre-refresh snapshot
    // for up to CACHE_TTL_MS (10 min).
    invalidateFeedCache();

    return { status: "ok" };
  } finally {
    isRunning = false;
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";
import { type ObjectStore } from "@/application/ports/object-store";
import { type LocalSnapshotSink } from "@/application/ports/local-snapshot-sink";
import { type FeedCacheInvalidator } from "@/application/ports/feed-cache-invalidator";
import {
  type CompileInput,
  type CompileResult,
} from "@/worker/jobs/compile-feeds";
import { createRefreshSupplyFeeds } from "./refresh-supply-feeds";

/**
 * RefreshSupplyFeeds orchestrator tests, against in-memory fakes — no R2, no
 * vendor network, no disk, no real compile. The fakes record every upload,
 * download, snapshot write, and cache-invalidation so the test can assert the
 * archive keys + content types, the R2 read-back compile input, the
 * throw-if-all-failed rule, skipPulls/onlyVendor handling, and the
 * end-of-run cache drop. The dev-gating of the snapshot itself is the adapter's
 * concern — the fake sink just records calls.
 */

class FakeObjectStore implements ObjectStore {
  readonly uploads: { key: string; bytes: Uint8Array; contentType: string }[] =
    [];
  readonly downloads: string[] = [];
  // Backing blobs so the R2 read-back in loadCompileInputFromR2 sees what the
  // archive step just wrote (R2 is strongly consistent read-after-write).
  readonly blobs = new Map<string, Uint8Array>();

  async upload(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    this.uploads.push({ key, bytes, contentType });
    this.blobs.set(key, bytes);
  }
  async download(key: string): Promise<Uint8Array | null> {
    this.downloads.push(key);
    return this.blobs.get(key) ?? null;
  }
  publicUrl(key: string): string {
    return `https://example.test/${key}`;
  }
  async presignedDownloadUrl(): Promise<{ url: string; expiresAt: Date }> {
    return { url: "https://example.test/signed", expiresAt: new Date() };
  }
}

class FakeSnapshotSink implements LocalSnapshotSink {
  readonly writes: { relativePath: string; bytes: Uint8Array }[] = [];
  async write(relativePath: string, bytes: Uint8Array): Promise<void> {
    this.writes.push({ relativePath, bytes });
  }
}

class FakeFeedCache implements FeedCacheInvalidator {
  invalidations = 0;
  invalidate(): void {
    this.invalidations += 1;
  }
}

function fakeSource(
  name: string,
  pull: () => Promise<unknown>,
): SupplyFeedSource {
  return { name, pull };
}

const VENDOR_NAMES = ["gunnold", "sulky"] as const;

function fakeCompileResult(): CompileResult {
  return {
    products: {
      source: "supplies-products",
      fetchedAt: "2026-01-01T00:00:00Z",
      keyCount: 0,
      vendorsIncluded: [],
      unmatchedByVendor: {},
      items: {},
    },
    listings: {
      source: "supplies-listings",
      fetchedAt: "2026-01-01T00:00:00Z",
      keyCount: 0,
      vendorsIncluded: [],
      items: [],
    },
    listingsCsv: "a,b,c\n",
  };
}

function deps(over: {
  sources?: SupplyFeedSource[];
  compile?: (input: CompileInput) => CompileResult;
} = {}) {
  const objectStore = new FakeObjectStore();
  const snapshotSink = new FakeSnapshotSink();
  const feedCache = new FakeFeedCache();
  const compileSpy = vi.fn(over.compile ?? (() => fakeCompileResult()));
  return {
    objectStore,
    snapshotSink,
    feedCache,
    compileSpy,
    full: {
      sources:
        over.sources ?? [
          fakeSource("gunnold", async () => ({ v: "g" })),
          fakeSource("sulky", async () => ({ v: "s" })),
        ],
      objectStore,
      snapshotSink,
      feedCache,
      compile: compileSpy,
      vendorNames: VENDOR_NAMES,
    },
  };
}

const DERIVED = [
  { key: "supplies/products/current.json", contentType: "application/json" },
  { key: "supplies/listings/current.json", contentType: "application/json" },
  { key: "supplies/listings/current.csv", contentType: "text/csv" },
];

describe("RefreshSupplyFeeds", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a normal run archives each vendor (current + dated archive) and writes the 3 derived feeds with the right keys + content types", async () => {
    const d = deps();
    const uc = createRefreshSupplyFeeds(d.full);

    const result = await uc.execute();
    expect(result).toEqual({ status: "ok" });

    const today = new Date().toISOString().slice(0, 10);
    const uploadKeys = d.objectStore.uploads.map((u) => u.key);
    // Each vendor → current + dated archive.
    expect(uploadKeys).toContain("supplies/gunnold/current.json");
    expect(uploadKeys).toContain(`supplies/gunnold/archive/${today}.json`);
    expect(uploadKeys).toContain("supplies/sulky/current.json");
    expect(uploadKeys).toContain(`supplies/sulky/archive/${today}.json`);

    // The 3 derived feeds, exact keys + content types.
    for (const { key, contentType } of DERIVED) {
      const up = d.objectStore.uploads.find((u) => u.key === key);
      expect(up, `expected upload for ${key}`).toBeDefined();
      expect(up!.contentType).toBe(contentType);
    }
  });

  it("rejects a concurrent overlap with { status: 'busy' } (mutual-exclusion flag)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const d = deps({
      sources: [
        fakeSource("gunnold", async () => {
          await gate; // hold the first run inside execute()
          return { v: "g" };
        }),
      ],
    });
    const uc = createRefreshSupplyFeeds(d.full);

    const first = uc.execute();
    // Second call lands while the first is still running.
    const second = await uc.execute();
    expect(second).toEqual({ status: "busy" });

    release();
    expect(await first).toEqual({ status: "ok" });
  });

  it("throws 'all vendors failed' when every attempted pull fails", async () => {
    const d = deps({
      sources: [
        fakeSource("gunnold", async () => {
          throw new Error("boom-g");
        }),
        fakeSource("sulky", async () => {
          throw new Error("boom-s");
        }),
      ],
    });
    const uc = createRefreshSupplyFeeds(d.full);

    await expect(uc.execute()).rejects.toThrow(
      "all vendors failed: gunnold, sulky",
    );
    // Compile never ran (threw before it).
    expect(d.compileSpy).not.toHaveBeenCalled();
    expect(d.feedCache.invalidations).toBe(0);
  });

  it("a partial failure still compiles and writes the derived feeds (and the survivor's snapshot feeds the compile)", async () => {
    const d = deps({
      sources: [
        fakeSource("gunnold", async () => {
          throw new Error("boom-g");
        }),
        fakeSource("sulky", async () => ({ v: "s" })),
      ],
    });
    const uc = createRefreshSupplyFeeds(d.full);

    const result = await uc.execute();
    expect(result).toEqual({ status: "ok" });

    // The survivor archived; the failure did not.
    const uploadKeys = d.objectStore.uploads.map((u) => u.key);
    expect(uploadKeys).toContain("supplies/sulky/current.json");
    expect(uploadKeys).not.toContain("supplies/gunnold/current.json");

    // Compile ran over the R2 read-back: sulky present, gunnold absent (never
    // wrote a snapshot this run, and the fake store starts empty).
    expect(d.compileSpy).toHaveBeenCalledTimes(1);
    const compileInput = d.compileSpy.mock.calls[0][0] as CompileInput;
    expect(compileInput).toEqual({ sulky: { v: "s" } });

    // Derived feeds still written; cache dropped.
    for (const { key } of DERIVED) {
      expect(uploadKeys).toContain(key);
    }
    expect(d.feedCache.invalidations).toBe(1);
  });

  it("skipPulls compiles WITHOUT pulling any vendor (reuses existing R2 snapshots)", async () => {
    const pulled: string[] = [];
    const d = deps({
      sources: [
        fakeSource("gunnold", async () => {
          pulled.push("gunnold");
          return { v: "g" };
        }),
      ],
    });
    // Pre-seed an existing R2 snapshot so the read-back has something.
    d.objectStore.blobs.set(
      "supplies/gunnold/current.json",
      new TextEncoder().encode(JSON.stringify({ v: "old-g" })),
    );

    const uc = createRefreshSupplyFeeds(d.full);
    const result = await uc.execute({ skipPulls: true });
    expect(result).toEqual({ status: "ok" });

    // No vendor was pulled, no vendor current/archive uploads happened.
    expect(pulled).toEqual([]);
    const uploadKeys = d.objectStore.uploads.map((u) => u.key);
    expect(uploadKeys).not.toContain("supplies/gunnold/current.json");

    // Compile ran over the pre-seeded snapshot; derived feeds written.
    expect(d.compileSpy).toHaveBeenCalledTimes(1);
    expect(d.compileSpy.mock.calls[0][0]).toEqual({ gunnold: { v: "old-g" } });
    for (const { key } of DERIVED) {
      expect(uploadKeys).toContain(key);
    }
  });

  it("onlyVendor narrows to one vendor; the others are not pulled", async () => {
    const pulled: string[] = [];
    const d = deps({
      sources: [
        fakeSource("gunnold", async () => {
          pulled.push("gunnold");
          return { v: "g" };
        }),
        fakeSource("sulky", async () => {
          pulled.push("sulky");
          return { v: "s" };
        }),
      ],
    });
    const uc = createRefreshSupplyFeeds(d.full);

    const result = await uc.execute({ onlyVendor: "sulky" });
    expect(result).toEqual({ status: "ok" });

    expect(pulled).toEqual(["sulky"]);
    const uploadKeys = d.objectStore.uploads.map((u) => u.key);
    expect(uploadKeys).toContain("supplies/sulky/current.json");
    expect(uploadKeys).not.toContain("supplies/gunnold/current.json");
    // Compile still runs (over the R2 snapshots).
    expect(d.compileSpy).toHaveBeenCalledTimes(1);
  });

  it("onlyVendor with no matching vendor returns { status: 'ok' } early, logs an error, and never compiles", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const d = deps();
    const uc = createRefreshSupplyFeeds(d.full);

    const result = await uc.execute({ onlyVendor: "nope" });
    expect(result).toEqual({ status: "ok" });

    expect(errorSpy).toHaveBeenCalledWith(
      "[refresh-embroidery-supplies] onlyVendor='nope' doesn't match any wired vendor",
    );
    // Early return: nothing uploaded, no compile, no cache drop.
    expect(d.objectStore.uploads).toEqual([]);
    expect(d.compileSpy).not.toHaveBeenCalled();
    expect(d.feedCache.invalidations).toBe(0);

    // And the busy flag was cleared (finally ran) — a follow-up run proceeds.
    const again = await uc.execute({ onlyVendor: "nope" });
    expect(again).toEqual({ status: "ok" });
  });

  it("invalidates the feed cache once, at the end of a successful run", async () => {
    const d = deps();
    const uc = createRefreshSupplyFeeds(d.full);
    await uc.execute();
    expect(d.feedCache.invalidations).toBe(1);
  });

  it("writes a dev snapshot for each vendor current.json AND each derived feed", async () => {
    const d = deps();
    const uc = createRefreshSupplyFeeds(d.full);
    await uc.execute();

    const snapshotPaths = d.snapshotSink.writes.map((w) => w.relativePath);
    // Vendor current snapshots (not the dated archive — that one isn't mirrored).
    expect(snapshotPaths).toContain("data/supplies/gunnold/current.json");
    expect(snapshotPaths).toContain("data/supplies/sulky/current.json");
    // Derived feed snapshots.
    expect(snapshotPaths).toContain("data/supplies/products/current.json");
    expect(snapshotPaths).toContain("data/supplies/listings/current.json");
    expect(snapshotPaths).toContain("data/supplies/listings/current.csv");
  });

  it("with no vendors configured, recompiles derived feeds from existing R2 snapshots", async () => {
    const d = deps({ sources: [] });
    const uc = createRefreshSupplyFeeds(d.full);

    const result = await uc.execute();
    expect(result).toEqual({ status: "ok" });
    // No pull uploads, but the 3 derived feeds are written and cache dropped.
    const uploadKeys = d.objectStore.uploads.map((u) => u.key);
    for (const { key } of DERIVED) {
      expect(uploadKeys).toContain(key);
    }
    expect(d.compileSpy).toHaveBeenCalledTimes(1);
    expect(d.feedCache.invalidations).toBe(1);
  });
});

import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";
import { GunnoldFeedSource } from "@/infrastructure/supply-feed/gunnold-feed-source";
import { SulkyFeedSource } from "@/infrastructure/supply-feed/sulky-feed-source";
import { AllstitchFeedSource } from "@/infrastructure/supply-feed/allstitch-feed-source";
import { HabanddashFeedSource } from "@/infrastructure/supply-feed/habanddash-feed-source";
import { ColdesiFeedSource } from "@/infrastructure/supply-feed/coldesi-feed-source";
import { ThreadartFeedSource } from "@/infrastructure/supply-feed/threadart-feed-source";
import { OhmycraftyFeedSource } from "@/infrastructure/supply-feed/ohmycrafty-feed-source";
import { DiskLocalSnapshotSink } from "@/infrastructure/supply-feed/disk-local-snapshot-sink";
import { FeedReaderCacheInvalidator } from "@/infrastructure/supply-feed/feed-reader-cache-invalidator";
import { getObjectStore } from "@/composition/object-store";
import {
  createRefreshSupplyFeeds,
  type RefreshSupplyFeeds,
} from "@/application/use-cases/supply-feed/refresh-supply-feeds";
import { VENDOR_NAMES, compileFeeds } from "@/worker/jobs/compile-feeds";

/**
 * Supply-feed composition root — wiring for the {@link SupplyFeedSource} port,
 * kept separate from the main `container.ts` on purpose (mirroring
 * `composition/object-store.ts` and `composition/content.ts`): the vendor
 * sources only *fetch and parse* — they touch no Mongo — and the supply-feed
 * refresh job's archival/compile path reaches its other deps through the
 * already-DB-free `object-store.ts`. Routing the sources through the DB-backed
 * container would drag `src/lib/mongodb.ts` (which connects/throws at import)
 * into the worker for no reason. So the sources get their own DB-free
 * composition.
 *
 * `getSupplyFeedSources()` returns the active vendors **in the exact order the
 * orchestrator's old inline `VENDORS` literal used** — the order is
 * behavior-bearing because the refresh loop's `Promise.allSettled` outcomes are
 * mapped back to vendor names positionally (and the `onlyVendor` filter walks
 * the same list). Do not reorder.
 *
 * madeirausa is **excluded** here exactly as it was commented out of the old
 * VENDORS literal — `pullMadeirausa` is a not-yet-implemented stub (Madeira USA
 * has no JSON API; HTML scraping required — see `madeirausa-pull.ts`). When the
 * scraper lands, add a `MadeiraUsaFeedSource` to the end of this list.
 */
export function getSupplyFeedSources(): SupplyFeedSource[] {
  return [
    new GunnoldFeedSource(),
    new SulkyFeedSource(),
    new AllstitchFeedSource(),
    // Hab+Dash price data is auth-gated behind Magento's customer-group
    // pricing; set HABANDDASH_EMAIL + HABANDDASH_PASSWORD in env to unlock.
    // Runs anonymous (all prices null) without creds.
    new HabanddashFeedSource(),
    new ColdesiFeedSource(),
    new ThreadartFeedSource(),
    new OhmycraftyFeedSource(),
    // TODO: implement HTML scraper — see madeirausa-pull.ts header for details.
    // new MadeiraUsaFeedSource(),
  ];
}

/**
 * Compose the {@link RefreshSupplyFeeds} orchestrator use-case — DB-free, like
 * `getSupplyFeedSources()` above. It needs only the vendor sources (this same
 * list, order preserved), the R2 object store (via the already-DB-free
 * `object-store.ts`), the dev-disk snapshot sink, the feed-cache invalidator,
 * and the pure-ish `compileFeeds` helper + `VENDOR_NAMES` (both kept in
 * `compile-feeds.ts`, unchanged). No Mongo touches this path, so it must not
 * route through the DB-backed `container.ts` (which connects at import).
 *
 * The use-case is a process-wide singleton so its mutual-exclusion flag is
 * process-wide — matching the old module-level `isRunning` boolean that both the
 * cron and the manual-refresh route shared.
 */
let refreshSupplyFeeds: RefreshSupplyFeeds | null = null;

export function getRefreshSupplyFeeds(): RefreshSupplyFeeds {
  if (!refreshSupplyFeeds) {
    refreshSupplyFeeds = createRefreshSupplyFeeds({
      sources: getSupplyFeedSources(),
      objectStore: getObjectStore(),
      snapshotSink: new DiskLocalSnapshotSink(),
      feedCache: new FeedReaderCacheInvalidator(),
      compile: compileFeeds,
      vendorNames: VENDOR_NAMES,
    });
  }
  return refreshSupplyFeeds;
}

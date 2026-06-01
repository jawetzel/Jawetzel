/**
 * Refresh embroidery supply feeds — thin worker entrypoint.
 *
 * The orchestration moved onto the hexagon: it now lives in the
 * `RefreshSupplyFeeds` application use-case, taking the injected
 * `SupplyFeedSource[]` (vendor pulls), the `ObjectStore` (R2 archives + derived
 * feeds), a `LocalSnapshotSink` (dev-disk mirror, dev-gated in the adapter), and
 * a `FeedCacheInvalidator`, plus the unchanged `compileFeeds` + `VENDOR_NAMES`.
 * It is wired DB-free in `composition/supply-feed.ts` (`getRefreshSupplyFeeds()`)
 * as a process-wide singleton, so its mutual-exclusion flag is process-wide —
 * matching the old module-level boolean.
 *
 * This file stays as a thin wrapper so both drivers keep importing
 * `runRefreshEmbroiderySupplies` unchanged: the cron scheduler
 * (`src/worker/index.ts`) calls it with no options, and the manual-refresh route
 * (`/api/tools/embroidery-supplies/refresh`) calls it with `{ skipPulls,
 * onlyVendor }` (the route still imports `VENDOR_NAMES` from `compile-feeds`).
 *
 * Behavior is unchanged: identical mutual-exclusion/busy, identical archive keys
 * (current + archive/<YYYY-MM-DD>) + the three derived feed keys/content-types,
 * identical dev-snapshot dev-gating, identical R2 read-back compile input,
 * identical `Promise.allSettled` + throw-if-all-failed rule, identical
 * skipPulls/onlyVendor handling incl. the no-match early return, identical
 * feed-cache invalidation, identical `RefreshResult` shape, and every log line.
 */

import { getRefreshSupplyFeeds } from "@/composition/supply-feed";

export type { RefreshResult } from "@/application/use-cases/supply-feed/refresh-supply-feeds";

export async function runRefreshEmbroiderySupplies(
  options: { skipPulls?: boolean; onlyVendor?: string } = {},
) {
  return getRefreshSupplyFeeds().execute(options);
}

/**
 * FeedCacheInvalidator — a driven port for dropping the in-process supply-feed
 * reader cache.
 *
 * Consumer-owned: `RefreshSupplyFeeds` calls `invalidate()` at the very end of a
 * run so the next API read reloads the freshly-uploaded R2 data instead of
 * serving the pre-refresh snapshot for up to the reader's cache TTL. It says
 * "drop the feed cache," never "reach into `lib/ai/embroidery-supplies/feeds`."
 * The production adapter
 * (`infrastructure/supply-feed/FeedReaderCacheInvalidator`) delegates to the
 * unchanged `invalidateFeedCache`; a fake records that it ran.
 *
 * Synchronous by contract — mirroring the historical `invalidateFeedCache()`,
 * which clears an in-process map with no I/O.
 */
export interface FeedCacheInvalidator {
  /** Drop the in-process feed-reader cache so the next read reloads from R2. */
  invalidate(): void;
}

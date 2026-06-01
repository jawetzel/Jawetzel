import { invalidateFeedCache } from "@/lib/ai/embroidery-supplies/feeds";
import { type FeedCacheInvalidator } from "@/application/ports/feed-cache-invalidator";

/**
 * FeedReaderCacheInvalidator — the production {@link FeedCacheInvalidator}. It
 * delegates to the unchanged `invalidateFeedCache` in
 * `lib/ai/embroidery-supplies/feeds`, which drops the in-process feed-reader
 * cache so the next API call reloads the freshly-uploaded R2 data instead of
 * serving the pre-refresh snapshot for up to CACHE_TTL_MS (10 min). The reader
 * itself stays flat; this is the only indirection added.
 */
export class FeedReaderCacheInvalidator implements FeedCacheInvalidator {
  invalidate(): void {
    invalidateFeedCache();
  }
}

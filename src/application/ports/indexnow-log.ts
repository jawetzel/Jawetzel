/**
 * IndexNowLog — a driven port for the per-URL ping ledger (the Mongo
 * `indexnow_log` collection).
 *
 * Consumer-owned: this interface lives with the application layer because
 * `PingIndexNow` is its only consumer, and it exposes exactly the three
 * operations that use-case needs — sync a content date in, read back the due
 * set, stamp a set as pinged. It is named for the *capability* (a ping ledger),
 * never the technology. The production adapter is
 * `infrastructure/indexnow/MongoIndexNowLog` (which wraps the unchanged
 * `src/lib/indexnow-tracker` functions, including the due-logic Mongo query);
 * tests use an in-memory fake.
 */

/** A URL that the ledger reports is due for a fresh IndexNow ping. */
export interface DueUrl {
  pagePath: string;
}

export interface IndexNowLog {
  /**
   * Record the current content date for a page. Existing rows keep their
   * `lastPingedAt`; new rows insert with `lastPingedAt = null` so they ping on
   * the next sweep.
   */
  upsert(pagePath: string, contentUpdatedAt: Date): Promise<void>;

  /**
   * URLs that need a fresh ping: never pinged, content changed since the last
   * ping, or last ping older than the staleness window.
   */
  findDue(): Promise<DueUrl[]>;

  /** Stamp `lastPingedAt = now` on a set of paths (no-op for an empty set). */
  stampPinged(pagePaths: string[]): Promise<void>;
}

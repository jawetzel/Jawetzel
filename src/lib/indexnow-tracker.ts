import type { ObjectId } from "mongodb";
import { getDb } from "./mongodb";

const COLLECTION = "indexnow_log";

export interface IndexNowLogEntry {
  _id?: ObjectId;
  pagePath: string;
  contentUpdatedAt: Date;
  lastPingedAt: Date | null;
}

/**
 * Record the current content date for a page. If the entry already exists,
 * `contentUpdatedAt` is overwritten but `lastPingedAt` is left alone — the
 * sweep will detect the new content date and re-ping. New rows are created
 * with `lastPingedAt = null` so they ping on the next sweep.
 */
export async function upsertPageContent(
  pagePath: string,
  contentUpdatedAt: Date,
): Promise<void> {
  const db = await getDb();
  await db.collection<IndexNowLogEntry>(COLLECTION).updateOne(
    { pagePath },
    {
      $set: { contentUpdatedAt },
      $setOnInsert: { pagePath, lastPingedAt: null },
    },
    { upsert: true },
  );
}

/**
 * Find URLs that need a fresh IndexNow ping. A page is due when:
 *   - it has never been pinged, OR
 *   - its content has changed since the last ping, OR
 *   - the last ping was more than `staleAfterDays` ago (default 7 days).
 *
 * The third clause ensures unchanged pages still get a periodic nudge so
 * search engines don't drop them from rotation.
 */
export async function findUrlsDueForPing(
  staleAfterDays = 7,
): Promise<IndexNowLogEntry[]> {
  const staleCutoff = new Date(
    Date.now() - staleAfterDays * 24 * 60 * 60 * 1000,
  );
  const db = await getDb();
  return db
    .collection<IndexNowLogEntry>(COLLECTION)
    .find({
      $or: [
        { lastPingedAt: null },
        { $expr: { $gt: ["$contentUpdatedAt", "$lastPingedAt"] } },
        { lastPingedAt: { $lt: staleCutoff } },
      ],
    })
    .toArray();
}

/** Stamp `lastPingedAt = now` on a set of paths. */
export async function stampPinged(pagePaths: string[]): Promise<void> {
  if (pagePaths.length === 0) return;
  const db = await getDb();
  await db
    .collection<IndexNowLogEntry>(COLLECTION)
    .updateMany(
      { pagePath: { $in: pagePaths } },
      { $set: { lastPingedAt: new Date() } },
    );
}

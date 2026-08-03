import { type Collection, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { merge, type GapKeyword, type GapStatus } from "@/domain/seo/gap-pile";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";

/**
 * MongoSeoGapRepository — the production {@link SeoGapRepository}.
 *
 * One collection, `seo_gap_keywords`, unique on `(tag, keyword)`.
 *
 * **`mergeAll` reads before it writes, deliberately.** A blind `$set` upsert
 * would be one round trip instead of two, and would silently overwrite
 * `status` and `firstSeenAt` — the two fields on this row that no vendor
 * response contains and that nothing can reconstruct. The read is what lets
 * `merge` decide which fields survive; the cost is one indexed query per
 * refresh, against a pile that is thousands of rows at most.
 */

const COLLECTION = "seo_gap_keywords";

interface GapDoc extends Omit<GapKeyword, "firstSeenAt" | "lastSeenAt"> {
  firstSeenAt: Date;
  lastSeenAt: Date;
}

let indexesEnsured: Promise<void> | null = null;

async function ensureIndexes(db: Db): Promise<void> {
  if (!indexesEnsured) {
    indexesEnsured = Promise.all([
      db
        .collection<GapDoc>(COLLECTION)
        .createIndex(
          { tag: 1, keyword: 1 },
          { name: "tag_keyword", unique: true },
        ),
      // The review screen reads one tag filtered by bucket and status.
      db
        .collection<GapDoc>(COLLECTION)
        .createIndex(
          { tag: 1, bucket: 1, status: 1 },
          { name: "tag_bucket_status" },
        ),
    ])
      .then(() => undefined)
      .catch((cause) => {
        indexesEnsured = null;
        throw cause;
      });
  }
  await indexesEnsured;
}

async function collection(): Promise<Collection<GapDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<GapDoc>(COLLECTION);
}

function toRow(doc: GapDoc): GapKeyword {
  return {
    tag: doc.tag,
    keyword: doc.keyword,
    location: doc.location,
    bucket: doc.bucket,
    status: doc.status,
    searchVolume: doc.searchVolume ?? null,
    cpc: doc.cpc ?? null,
    competition: doc.competition ?? null,
    difficulty: doc.difficulty ?? null,
    intent: doc.intent ?? null,
    ourPosition: doc.ourPosition ?? null,
    ourUrl: doc.ourUrl ?? null,
    competitors: doc.competitors ?? [],
    screening: doc.screening ?? null,
    firstSeenAt: doc.firstSeenAt.toISOString(),
    lastSeenAt: doc.lastSeenAt.toISOString(),
  };
}

function toDoc(row: GapKeyword): GapDoc {
  return {
    ...row,
    firstSeenAt: new Date(row.firstSeenAt),
    lastSeenAt: new Date(row.lastSeenAt),
  };
}

export class MongoSeoGapRepository implements SeoGapRepository {
  async mergeAll(input: {
    tag: string;
    observed: GapKeyword[];
  }): Promise<{ added: number; refreshed: number }> {
    if (input.observed.length === 0) return { added: 0, refreshed: 0 };
    const col = await collection();

    const keywords = input.observed.map((row) => row.keyword);
    const existing = await col
      .find({ tag: input.tag, keyword: { $in: keywords } })
      .toArray();
    const storedByKeyword = new Map(existing.map((d) => [d.keyword, toRow(d)]));

    let added = 0;
    let refreshed = 0;
    const operations = input.observed.map((observed) => {
      const stored = storedByKeyword.get(observed.keyword);
      if (stored) refreshed += 1;
      else added += 1;
      const next = stored ? merge(stored, observed) : observed;
      return {
        updateOne: {
          filter: { tag: input.tag, keyword: next.keyword },
          update: { $set: toDoc(next) },
          upsert: true,
        },
      };
    });

    await col.bulkWrite(operations, { ordered: false });
    return { added, refreshed };
  }

  async list(input: {
    tag: string;
    bucket?: GapKeyword["bucket"];
    status?: GapStatus;
    limit: number;
  }): Promise<GapKeyword[]> {
    const col = await collection();
    const docs = await col
      .find({
        tag: input.tag,
        ...(input.bucket ? { bucket: input.bucket } : {}),
        ...(input.status ? { status: input.status } : {}),
      })
      // The port's ordering guarantee. Descending puts missing volumes last,
      // since BSON sorts null below every number — which is what we want: a row
      // the vendor never priced is the first thing to drop, not the last.
      .sort({ searchVolume: -1, keyword: 1 })
      .limit(input.limit)
      .toArray();
    return docs.map(toRow);
  }

  async setStatus(input: {
    tag: string;
    keywords: string[];
    status: GapStatus;
  }): Promise<number> {
    if (input.keywords.length === 0) return 0;
    const col = await collection();
    const result = await col.updateMany(
      { tag: input.tag, keyword: { $in: input.keywords } },
      { $set: { status: input.status } },
    );
    return result.modifiedCount;
  }

  async countByStatus(input: {
    tag: string;
  }): Promise<Record<GapStatus, number>> {
    const col = await collection();
    const rows = await col
      .aggregate<{ _id: GapStatus; count: number }>([
        { $match: { tag: input.tag } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray();
    const counts: Record<GapStatus, number> = {
      new: 0,
      accepted: 0,
      rejected: 0,
    };
    for (const row of rows) {
      if (row._id in counts) counts[row._id] = row.count;
    }
    return counts;
  }
}

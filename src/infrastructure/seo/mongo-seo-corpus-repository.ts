import { type Collection, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { type SerpObservation } from "@/domain/seo/serp-facts";
import { type RankedKeywordsObservation } from "@/domain/seo/competitor-queries";
import { type KeywordMetric } from "@/application/ports/keyword-metrics-gateway";
import {
  type PageSnapshotRow,
  type SeoCorpusRepository,
} from "@/application/ports/seo-corpus-repository";

/**
 * MongoSeoCorpusRepository — the production {@link SeoCorpusRepository}.
 *
 * Four collections, matching seo.md Part 4's raw layer. The `seo_` prefix
 * exists because this database is shared with the rest of jawetzel.com; the doc
 * names them `serp_snapshots` / `page_snapshots` / `keyword_metrics` /
 * `ranked_keywords`.
 *
 *   seo_serp_snapshots    (query, location, capturedAt)  — APPEND ONLY.
 *   seo_page_snapshots    (propertyId, url, capturedAt)  — written on hash change.
 *   seo_keyword_metrics   (query, location)              — upserted.
 *   seo_ranked_keywords   (target, location, capturedAt) — APPEND ONLY.
 *
 * The privacy line lives in the keys: the SERP, keyword, and ranked-keyword
 * collections carry no property identifier because nobody owns what ranks for a
 * query — what a domain ranks for is public observation too — and they pool
 * across every caller. `seo_page_snapshots` carries `propertyId` because it is
 * the caller's own content.
 *
 * **Nothing here deletes.** No TTL index, no pruning job. "Deleting old data to
 * save a few dollars trades away the only thing here that cannot be bought
 * back." A retention policy added later would silently destroy the corpus that
 * makes every history fact computable.
 */

const SERP_COLLECTION = "seo_serp_snapshots";
const PAGE_COLLECTION = "seo_page_snapshots";
const KEYWORD_COLLECTION = "seo_keyword_metrics";
const RANKED_COLLECTION = "seo_ranked_keywords";

/** Stored SERP snapshot. `capturedAt` is a Date in Mongo, ISO on the wire. */
interface SerpSnapshotDoc {
  query: string;
  location: string;
  capturedAt: Date;
  results: SerpObservation["results"];
  features: string[];
  paaQuestions: string[];
}

interface PageSnapshotDoc extends Omit<PageSnapshotRow, "capturedAt"> {
  capturedAt: Date;
}

interface KeywordMetricDoc extends Omit<KeywordMetric, "capturedAt"> {
  location: string;
  capturedAt: Date;
}

interface RankedKeywordsDoc
  extends Omit<RankedKeywordsObservation, "capturedAt"> {
  capturedAt: Date;
}

let indexesEnsured: Promise<void> | null = null;

/**
 * Ensure indexes exactly once per process. A transient failure is not cached, so
 * the next call retries — same idiom as `lib/ai/conversations`.
 */
async function ensureIndexes(db: Db): Promise<void> {
  if (!indexesEnsured) {
    indexesEnsured = Promise.all([
      // Freshness lookups and history windows are both "this query, this
      // location, newest first" — one compound index serves both.
      db
        .collection<SerpSnapshotDoc>(SERP_COLLECTION)
        .createIndex(
          { query: 1, location: 1, capturedAt: -1 },
          { name: "query_location_captured" },
        ),
      db
        .collection<PageSnapshotDoc>(PAGE_COLLECTION)
        .createIndex({ url: 1, capturedAt: -1 }, { name: "url_captured" }),
      db
        .collection<PageSnapshotDoc>(PAGE_COLLECTION)
        .createIndex(
          { propertyId: 1, capturedAt: -1 },
          { name: "property_captured" },
        ),
      db
        .collection<KeywordMetricDoc>(KEYWORD_COLLECTION)
        .createIndex(
          { query: 1, location: 1 },
          { name: "query_location", unique: true },
        ),
      // Same shape as the SERP index: "this target, this location, newest
      // first" serves both the freshness lookup and any later history read.
      db
        .collection<RankedKeywordsDoc>(RANKED_COLLECTION)
        .createIndex(
          { target: 1, location: 1, capturedAt: -1 },
          { name: "target_location_captured" },
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

async function serpCollection(): Promise<Collection<SerpSnapshotDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<SerpSnapshotDoc>(SERP_COLLECTION);
}

async function pageCollection(): Promise<Collection<PageSnapshotDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<PageSnapshotDoc>(PAGE_COLLECTION);
}

async function keywordCollection(): Promise<Collection<KeywordMetricDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<KeywordMetricDoc>(KEYWORD_COLLECTION);
}

async function rankedCollection(): Promise<Collection<RankedKeywordsDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<RankedKeywordsDoc>(RANKED_COLLECTION);
}

function toObservation(doc: SerpSnapshotDoc): SerpObservation {
  return {
    query: doc.query,
    location: doc.location,
    capturedAt: doc.capturedAt.toISOString(),
    results: doc.results,
    features: doc.features,
    paaQuestions: doc.paaQuestions,
  };
}

export class MongoSeoCorpusRepository implements SeoCorpusRepository {
  async findRecentSnapshot(input: {
    query: string;
    location: string;
    maxAgeDays: number;
  }): Promise<SerpObservation | null> {
    // A zero-day window means "force a fresh observation" — skip the read
    // entirely rather than relying on sub-millisecond clock luck.
    if (input.maxAgeDays <= 0) return null;
    const col = await serpCollection();
    const cutoff = new Date(Date.now() - input.maxAgeDays * 86_400_000);
    const doc = await col.findOne(
      {
        query: input.query,
        location: input.location,
        capturedAt: { $gte: cutoff },
      },
      { sort: { capturedAt: -1 } },
    );
    return doc ? toObservation(doc) : null;
  }

  async findSnapshots(input: {
    query: string;
    location: string;
    since: string;
  }): Promise<SerpObservation[]> {
    const col = await serpCollection();
    const docs = await col
      .find({
        query: input.query,
        location: input.location,
        capturedAt: { $gte: new Date(input.since) },
      })
      .sort({ capturedAt: 1 })
      .toArray();
    return docs.map(toObservation);
  }

  async saveSnapshot(observation: SerpObservation): Promise<void> {
    const col = await serpCollection();
    await col.insertOne({
      query: observation.query,
      location: observation.location,
      capturedAt: new Date(observation.capturedAt),
      results: observation.results,
      features: observation.features,
      paaQuestions: observation.paaQuestions,
    });
  }

  async savePageSnapshot(row: PageSnapshotRow): Promise<void> {
    const col = await pageCollection();
    await col.insertOne({ ...row, capturedAt: new Date(row.capturedAt) });
  }

  async latestPageContentHash(url: string): Promise<string | null> {
    const col = await pageCollection();
    const doc = await col.findOne(
      { url },
      { sort: { capturedAt: -1 }, projection: { contentHash: 1 } },
    );
    return doc?.contentHash ?? null;
  }

  async upsertKeywordMetrics(input: {
    location: string;
    metrics: KeywordMetric[];
  }): Promise<void> {
    if (input.metrics.length === 0) return;
    const col = await keywordCollection();
    await col.bulkWrite(
      input.metrics.map((metric) => ({
        updateOne: {
          filter: { query: metric.query, location: input.location },
          update: {
            $set: {
              ...metric,
              location: input.location,
              capturedAt: new Date(metric.capturedAt),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async findKeywordMetrics(input: {
    queries: string[];
    location: string;
    maxAgeDays: number;
  }): Promise<KeywordMetric[]> {
    if (input.queries.length === 0) return [];
    const col = await keywordCollection();
    const cutoff = new Date(Date.now() - input.maxAgeDays * 86_400_000);
    const docs = await col
      .find({
        query: { $in: input.queries },
        location: input.location,
        capturedAt: { $gte: cutoff },
      })
      .toArray();
    return docs.map((doc) => ({
      query: doc.query,
      searchVolume: doc.searchVolume,
      cpc: doc.cpc,
      competition: doc.competition,
      difficulty: doc.difficulty,
      intent: doc.intent,
      monthlySearches: doc.monthlySearches ?? [],
      capturedAt: doc.capturedAt.toISOString(),
    }));
  }

  async findRecentRankedKeywords(input: {
    target: string;
    location: string;
    maxAgeDays: number;
  }): Promise<RankedKeywordsObservation | null> {
    if (input.maxAgeDays <= 0) return null;
    const col = await rankedCollection();
    const cutoff = new Date(Date.now() - input.maxAgeDays * 86_400_000);
    const doc = await col.findOne(
      {
        target: input.target,
        location: input.location,
        capturedAt: { $gte: cutoff },
      },
      { sort: { capturedAt: -1 } },
    );
    if (!doc) return null;
    return {
      target: doc.target,
      location: doc.location,
      capturedAt: doc.capturedAt.toISOString(),
      totalCount: doc.totalCount,
      rows: doc.rows,
    };
  }

  async saveRankedKeywords(
    observation: RankedKeywordsObservation,
  ): Promise<void> {
    const col = await rankedCollection();
    await col.insertOne({
      target: observation.target,
      location: observation.location,
      capturedAt: new Date(observation.capturedAt),
      totalCount: observation.totalCount,
      rows: observation.rows,
    });
  }
}

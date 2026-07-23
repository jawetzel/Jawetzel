import { type Collection, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  type SeoAnalysisRepository,
  type StoredPageAnalysis,
} from "@/application/ports/seo-analysis-repository";

/**
 * MongoSeoAnalysisRepository — the production {@link SeoAnalysisRepository}.
 *
 * One collection, `seo_page_analysis` (seo.md Part 4's derived `page_analysis`).
 * Unlike the raw corpus this layer is regenerable: every row can be rebuilt from
 * the stored SERP/page snapshots by re-running the analysis at a given
 * `formulaVersion`. It exists so the admin surface can list past runs and
 * re-open one without paying for a fresh crawl.
 *
 * Append-only like the rest of the SEO storage — no updates, no pruning.
 */

const COLLECTION = "seo_page_analysis";

/** `runAt` is a Date in Mongo (sortable/indexable), ISO on the wire. */
interface PageAnalysisDoc extends Omit<StoredPageAnalysis, "runAt"> {
  runAt: Date;
}

let indexesEnsured: Promise<void> | null = null;

async function ensureIndexes(db: Db): Promise<void> {
  if (!indexesEnsured) {
    indexesEnsured = Promise.all([
      // "Recent runs, newest first" is the only read.
      db
        .collection<PageAnalysisDoc>(COLLECTION)
        .createIndex({ runAt: -1 }, { name: "run_at" }),
      // Re-opening the history for one URL stays cheap as the collection grows.
      db
        .collection<PageAnalysisDoc>(COLLECTION)
        .createIndex({ url: 1, runAt: -1 }, { name: "url_run_at" }),
    ])
      .then(() => undefined)
      .catch((cause) => {
        indexesEnsured = null;
        throw cause;
      });
  }
  await indexesEnsured;
}

async function collection(): Promise<Collection<PageAnalysisDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<PageAnalysisDoc>(COLLECTION);
}

function toRecord(doc: PageAnalysisDoc): StoredPageAnalysis {
  return {
    propertyId: doc.propertyId,
    url: doc.url,
    query: doc.query,
    location: doc.location,
    runAt: doc.runAt.toISOString(),
    formulaVersion: doc.formulaVersion,
    swaps: doc.swaps,
    sample: doc.sample,
  };
}

export class MongoSeoAnalysisRepository implements SeoAnalysisRepository {
  async save(record: StoredPageAnalysis): Promise<void> {
    const col = await collection();
    await col.insertOne({ ...record, runAt: new Date(record.runAt) });
  }

  async listRecent(input: { limit: number }): Promise<StoredPageAnalysis[]> {
    const col = await collection();
    const docs = await col
      .find({})
      .sort({ runAt: -1 })
      .limit(input.limit)
      .toArray();
    return docs.map(toRecord);
  }
}

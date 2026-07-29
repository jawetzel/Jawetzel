import { ObjectId, type Collection, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { type WorkOrder } from "@/domain/seo/work-order";
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
 * Append-only — no updates, no pruning.
 *
 * A second collection, `seo_work_orders`, caches the rendered prose for a run.
 * It is upserted rather than appended because it is a cache, and it lives apart
 * precisely so `seo_page_analysis` keeps its append-only invariant: a rendering
 * is regenerable from the stored swaps for tokens alone, an analysis is not.
 */

const COLLECTION = "seo_page_analysis";
const WORK_ORDER_COLLECTION = "seo_work_orders";

/** `runAt` is a Date in Mongo (sortable/indexable), ISO on the wire. */
interface PageAnalysisDoc extends Omit<StoredPageAnalysis, "runAt" | "id"> {
  runAt: Date;
}

interface WorkOrderDoc {
  analysisId: ObjectId;
  workOrder: WorkOrder;
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
      db
        .collection<WorkOrderDoc>(WORK_ORDER_COLLECTION)
        .createIndex(
          { analysisId: 1 },
          { name: "analysis_id", unique: true },
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

async function collection(): Promise<Collection<PageAnalysisDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<PageAnalysisDoc>(COLLECTION);
}

async function workOrderCollection(): Promise<Collection<WorkOrderDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<WorkOrderDoc>(WORK_ORDER_COLLECTION);
}

function toRecord(doc: PageAnalysisDoc & { _id?: ObjectId }): StoredPageAnalysis {
  return {
    id: doc._id?.toString(),
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
  async save(record: StoredPageAnalysis): Promise<string> {
    const col = await collection();
    // `id` is assigned by Mongo; a caller-supplied one would collide with `_id`.
    const { id: _id, ...rest } = record;
    const result = await col.insertOne({
      ...rest,
      runAt: new Date(record.runAt),
    });
    return result.insertedId.toString();
  }

  async findById(id: string): Promise<StoredPageAnalysis | null> {
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      // A malformed id is "no such run", not a fault worth throwing over.
      return null;
    }
    const col = await collection();
    const doc = await col.findOne({ _id: objectId });
    return doc ? toRecord(doc) : null;
  }

  async saveWorkOrder(input: {
    analysisId: string;
    workOrder: WorkOrder;
  }): Promise<void> {
    const col = await workOrderCollection();
    await col.updateOne(
      { analysisId: new ObjectId(input.analysisId) },
      { $set: { workOrder: input.workOrder } },
      { upsert: true },
    );
  }

  async findWorkOrder(analysisId: string): Promise<WorkOrder | null> {
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(analysisId);
    } catch {
      return null;
    }
    const col = await workOrderCollection();
    const doc = await col.findOne({ analysisId: objectId });
    return doc?.workOrder ?? null;
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

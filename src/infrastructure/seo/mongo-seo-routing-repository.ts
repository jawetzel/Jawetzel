import { type Collection, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { type Routing, type RouteVerdict } from "@/domain/seo/routing";
import { type SeoRoutingRepository } from "@/application/ports/seo-routing-repository";

/**
 * MongoSeoRoutingRepository — the production {@link SeoRoutingRepository}.
 *
 * One collection, `seo_routings`, unique on `(tag, pageUrl, keyword)`.
 *
 * **Never deleted, never pruned.** Unlike the gap pile this is not a working
 * set — it is the record of what every page run decided, and the backlog is a
 * derivation over the whole of it. Dropping old rows would quietly shrink the
 * denominator that makes the backlog trustworthy.
 */

const COLLECTION = "seo_routings";

interface RoutingDoc extends Omit<Routing, "routedAt"> {
  routedAt: Date;
}

let indexesEnsured: Promise<void> | null = null;

async function ensureIndexes(db: Db): Promise<void> {
  if (!indexesEnsured) {
    indexesEnsured = Promise.all([
      db
        .collection<RoutingDoc>(COLLECTION)
        .createIndex(
          { tag: 1, pageUrl: 1, keyword: 1 },
          { name: "tag_page_keyword", unique: true },
        ),
      // The backlog reads every routing for a tag and folds by keyword.
      db
        .collection<RoutingDoc>(COLLECTION)
        .createIndex({ tag: 1, verdict: 1 }, { name: "tag_verdict" }),
    ])
      .then(() => undefined)
      .catch((cause) => {
        indexesEnsured = null;
        throw cause;
      });
  }
  await indexesEnsured;
}

async function collection(): Promise<Collection<RoutingDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<RoutingDoc>(COLLECTION);
}

function toRouting(doc: RoutingDoc): Routing {
  return {
    tag: doc.tag,
    pageUrl: doc.pageUrl,
    keyword: doc.keyword,
    verdict: doc.verdict,
    rationale: doc.rationale ?? null,
    overridden: doc.overridden ?? false,
    routedAt: doc.routedAt.toISOString(),
  };
}

export class MongoSeoRoutingRepository implements SeoRoutingRepository {
  async saveAll(input: {
    tag: string;
    pageUrl: string;
    routings: Routing[];
  }): Promise<{ written: number; preserved: number }> {
    if (input.routings.length === 0) return { written: 0, preserved: 0 };
    const col = await collection();

    // A human correction outranks a re-run of the model. Read the overridden
    // rows first and leave them exactly as they are.
    const overridden = await col
      .find(
        { tag: input.tag, pageUrl: input.pageUrl, overridden: true },
        { projection: { keyword: 1 } },
      )
      .toArray();
    const locked = new Set(overridden.map((d) => d.keyword));

    const writable = input.routings.filter((r) => !locked.has(r.keyword));
    if (writable.length > 0) {
      await col.bulkWrite(
        writable.map((routing) => ({
          updateOne: {
            filter: {
              tag: routing.tag,
              pageUrl: routing.pageUrl,
              keyword: routing.keyword,
            },
            update: {
              $set: { ...routing, routedAt: new Date(routing.routedAt) },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }

    return { written: writable.length, preserved: locked.size };
  }

  async list(input: {
    tag: string;
    pageUrl?: string;
    limit: number;
  }): Promise<Routing[]> {
    const col = await collection();
    const docs = await col
      .find({
        tag: input.tag,
        ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      })
      .limit(input.limit)
      .toArray();
    return docs.map(toRouting);
  }

  async override(input: {
    tag: string;
    pageUrl: string;
    keyword: string;
    verdict: RouteVerdict;
  }): Promise<boolean> {
    const col = await collection();
    const result = await col.updateOne(
      { tag: input.tag, pageUrl: input.pageUrl, keyword: input.keyword },
      { $set: { verdict: input.verdict, overridden: true } },
    );
    return result.matchedCount > 0;
  }

  async countRoutedPages(input: { tag: string }): Promise<number> {
    const col = await collection();
    const pages = await col.distinct("pageUrl", { tag: input.tag });
    return pages.length;
  }
}

import { type Collection, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { type IntelRun, type SeoTag } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * MongoSeoWorkspaceRepository — the production {@link SeoWorkspaceRepository}.
 *
 * Two collections:
 *
 *   seo_tags   (tag)    — unique. The engagement and its per-property config.
 *   seo_runs   (runId)  — unique. One layer-1/2 intel refresh, with its gate.
 *
 * Both are upserted rather than appended, because unlike the corpus these are
 * *mutable working state* — a run is edited in place as it advances through the
 * gates. The observations a run captured are already append-only in the corpus,
 * so nothing perishable is being overwritten here.
 *
 * `createdAt` / `updatedAt` / `capturedAt` are Dates in Mongo (sortable and
 * indexable) and ISO strings on the wire, matching the corpus repository.
 */

const TAG_COLLECTION = "seo_tags";
const RUN_COLLECTION = "seo_runs";

interface TagDoc extends Omit<SeoTag, "createdAt"> {
  createdAt: Date;
}

interface RunDoc extends Omit<IntelRun, "createdAt" | "updatedAt"> {
  createdAt: Date;
  updatedAt: Date;
}

let indexesEnsured: Promise<void> | null = null;

/** Ensure indexes exactly once per process; a transient failure is not cached. */
async function ensureIndexes(db: Db): Promise<void> {
  if (!indexesEnsured) {
    indexesEnsured = Promise.all([
      db
        .collection<TagDoc>(TAG_COLLECTION)
        .createIndex({ tag: 1 }, { name: "tag", unique: true }),
      db
        .collection<RunDoc>(RUN_COLLECTION)
        .createIndex({ runId: 1 }, { name: "run_id", unique: true }),
      // "This tag's runs, newest first" is the history read behind the tag page.
      db
        .collection<RunDoc>(RUN_COLLECTION)
        .createIndex({ tag: 1, createdAt: -1 }, { name: "tag_created" }),
    ])
      .then(() => undefined)
      .catch((cause) => {
        indexesEnsured = null;
        throw cause;
      });
  }
  await indexesEnsured;
}

async function tagCollection(): Promise<Collection<TagDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<TagDoc>(TAG_COLLECTION);
}

async function runCollection(): Promise<Collection<RunDoc>> {
  const db = await getDb();
  await ensureIndexes(db);
  return db.collection<RunDoc>(RUN_COLLECTION);
}

function toTag(doc: TagDoc): SeoTag {
  return {
    tag: doc.tag,
    label: doc.label,
    domain: doc.domain,
    locationCode: doc.locationCode,
    languageCode: doc.languageCode,
    entitySchema: doc.entitySchema ?? [],
    urgencyTerms: doc.urgencyTerms ?? [],
    city: doc.city ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toRun(doc: RunDoc): IntelRun {
  return {
    runId: doc.runId,
    tag: doc.tag,
    keywords: doc.keywords ?? [],
    locationCode: doc.locationCode,
    languageCode: doc.languageCode,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    competitors: doc.competitors ?? null,
    approvedCompetitors: doc.approvedCompetitors ?? null,
  };
}

export class MongoSeoWorkspaceRepository implements SeoWorkspaceRepository {
  async saveTag(tag: SeoTag): Promise<void> {
    const col = await tagCollection();
    const { createdAt, ...rest } = tag;
    await col.updateOne(
      { tag: tag.tag },
      {
        $set: rest,
        // Creation time belongs to the first write; re-saving config must not
        // rewrite the tag's own history.
        $setOnInsert: { createdAt: new Date(createdAt) },
      },
      { upsert: true },
    );
  }

  async findTag(tag: string): Promise<SeoTag | null> {
    const col = await tagCollection();
    const doc = await col.findOne({ tag });
    return doc ? toTag(doc) : null;
  }

  async listTags(): Promise<SeoTag[]> {
    const col = await tagCollection();
    const docs = await col.find({}).sort({ label: 1 }).toArray();
    return docs.map(toTag);
  }

  async saveRun(run: IntelRun): Promise<void> {
    const col = await runCollection();
    const { createdAt, updatedAt, ...rest } = run;
    await col.updateOne(
      { runId: run.runId },
      {
        $set: { ...rest, updatedAt: new Date(updatedAt) },
        $setOnInsert: { createdAt: new Date(createdAt) },
      },
      { upsert: true },
    );
  }

  async findRun(runId: string): Promise<IntelRun | null> {
    const col = await runCollection();
    const doc = await col.findOne({ runId });
    return doc ? toRun(doc) : null;
  }

  async listRuns(input: { tag: string; limit: number }): Promise<IntelRun[]> {
    const col = await runCollection();
    const docs = await col
      .find({ tag: input.tag })
      .sort({ createdAt: -1 })
      .limit(input.limit)
      .toArray();
    return docs.map(toRun);
  }
}

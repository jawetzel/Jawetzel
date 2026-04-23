/**
 * CRUD for AI-assistant conversations.
 *
 * Shape: one document per conversation, messages embedded (bounded by the
 * sliding-window the chat lib applies on send). Anon conversations have no
 * `userId`; authed conversations reference `users._id`. Anon convos are
 * stored for analytics only — there is no read-back UI for them. An anon
 * convo can be adopted on sign-in via `claimAnon`.
 *
 * Indexes (run `ensureIndexes` once during deploy or manually via a script):
 *   { userId: 1, updatedAt: -1 }       partial, userId exists — authed list
 *   { createdAt: -1 }                                        — analytics scan
 */

import { ObjectId, type Filter, type WithId } from "mongodb";
import { getDb } from "@/lib/mongodb";

const COLLECTION = "conversations";
export const DEFAULT_CONVERSATIONS_PER_PAGE = 10;

export interface ToolResultPayload {
  tool: string;
  data: unknown;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  pageUrl?: string;
  toolResults?: ToolResultPayload[];
  createdAt: Date;
}

export interface ConversationDoc {
  _id?: ObjectId;
  userId?: ObjectId;
  title: string;
  messages: ConversationMessage[];
  ipAddress?: string;
  userAgent?: string;
  startPageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationListItem {
  _id: ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

function toObjectId(id: string | ObjectId): ObjectId {
  return id instanceof ObjectId ? id : new ObjectId(id);
}

let indexesEnsured: Promise<void> | null = null;

async function collection() {
  const db = await getDb();
  const col = db.collection<ConversationDoc>(COLLECTION);
  // Ensure indexes exactly once per process. Errors bubble as a rejected
  // promise, but we don't cache the rejection so a transient failure
  // retries on the next call.
  if (!indexesEnsured) {
    indexesEnsured = Promise.all([
      col.createIndex(
        { userId: 1, updatedAt: -1 },
        {
          name: "user_updatedAt",
          partialFilterExpression: { userId: { $exists: true } },
        },
      ),
      col.createIndex({ createdAt: -1 }, { name: "createdAt_desc" }),
    ])
      .then(() => undefined)
      .catch((err) => {
        indexesEnsured = null;
        throw err;
      });
  }
  await indexesEnsured;
  return col;
}

export async function ensureIndexes(): Promise<void> {
  await collection();
}

export async function createConversation(input: {
  userId?: ObjectId;
  title?: string;
  startPageUrl?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<WithId<ConversationDoc>> {
  const col = await collection();
  const now = new Date();
  const doc: ConversationDoc = {
    ...(input.userId && { userId: input.userId }),
    title: input.title ?? "New conversation",
    messages: [],
    ...(input.ipAddress && { ipAddress: input.ipAddress }),
    ...(input.userAgent && { userAgent: input.userAgent }),
    ...(input.startPageUrl && { startPageUrl: input.startPageUrl }),
    createdAt: now,
    updatedAt: now,
  };
  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function getConversation(
  id: string | ObjectId,
): Promise<WithId<ConversationDoc> | null> {
  const col = await collection();
  return col.findOne({ _id: toObjectId(id) });
}

/**
 * Fetch a conversation scoped to a specific user. Returns null when the
 * convo doesn't exist, belongs to someone else, or is anon.
 */
export async function getConversationForUser(
  id: string | ObjectId,
  userId: ObjectId,
): Promise<WithId<ConversationDoc> | null> {
  const col = await collection();
  return col.findOne({ _id: toObjectId(id), userId });
}

/**
 * Fetch an anon conversation (no `userId`) by id — used to validate anon
 * message sends don't target a claimed convo.
 */
export async function getAnonConversation(
  id: string | ObjectId,
): Promise<WithId<ConversationDoc> | null> {
  const col = await collection();
  return col.findOne({
    _id: toObjectId(id),
    userId: { $exists: false },
  } as Filter<ConversationDoc>);
}

export async function listConversationsForUser(
  userId: ObjectId,
  page = 1,
  perPage = DEFAULT_CONVERSATIONS_PER_PAGE,
): Promise<{
  items: ConversationListItem[];
  total: number;
  page: number;
  perPage: number;
}> {
  const col = await collection();
  const filter: Filter<ConversationDoc> = { userId };
  const total = await col.countDocuments(filter);
  const items = await col
    .find(filter, {
      projection: { title: 1, createdAt: 1, updatedAt: 1 },
    })
    .sort({ updatedAt: -1 })
    .skip((Math.max(1, page) - 1) * perPage)
    .limit(perPage)
    .toArray();
  return {
    items: items.map((it) => ({
      _id: it._id,
      title: it.title,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    })),
    total,
    page,
    perPage,
  };
}

export async function appendMessage(
  id: string | ObjectId,
  message: ConversationMessage,
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: toObjectId(id) },
    {
      $push: { messages: message },
      $set: { updatedAt: new Date() },
    },
  );
}

export async function setTitle(
  id: string | ObjectId,
  title: string,
): Promise<void> {
  const col = await collection();
  await col.updateOne(
    { _id: toObjectId(id) },
    { $set: { title, updatedAt: new Date() } },
  );
}

/**
 * Adopt an anon conversation for a now-signed-in user. Matches only convos
 * with no `userId` so an already-claimed convo can't be hijacked by another
 * session that still has the id in localStorage.
 */
export async function claimAnon(
  id: string | ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  const col = await collection();
  const result = await col.updateOne(
    {
      _id: toObjectId(id),
      userId: { $exists: false },
    } as Filter<ConversationDoc>,
    { $set: { userId, updatedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}

export async function deleteConversationForUser(
  id: string | ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  const col = await collection();
  const result = await col.deleteOne({ _id: toObjectId(id), userId });
  return result.deletedCount === 1;
}

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import type { DemoImage, Generation, User } from "@/types/user";

const COLLECTION = "users";

export async function findOrCreateGoogleUser(input: {
  googleId: string;
  email: string;
  name: string;
  image: string | null;
}): Promise<User> {
  const db = await getDb();
  const users = db.collection<User>(COLLECTION);

  const existing = await users.findOne({ googleId: input.googleId });
  if (existing) {
    const patch: Partial<User> = {};
    if (existing.email !== input.email) patch.email = input.email;
    if (existing.name !== input.name) patch.name = input.name;
    if (existing.image !== input.image) patch.image = input.image;
    if (Object.keys(patch).length > 0) {
      await users.updateOne({ _id: existing._id }, { $set: patch });
      return { ...existing, ...patch };
    }
    return existing;
  }

  const doc: User = {
    googleId: input.googleId,
    email: input.email,
    name: input.name,
    image: input.image,
    role: "user",
    createdAt: new Date(),
    apiKeyHash: null,
    demo_images: [],
    generations: [],
    api_generations: [],
  };
  const result = await users.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  return db.collection<User>(COLLECTION).findOne({ _id: new ObjectId(id) });
}

export async function findDemoImageByHash(
  userId: string,
  hash: string,
): Promise<DemoImage | null> {
  const db = await getDb();
  const user = await db
    .collection<User>(COLLECTION)
    .findOne(
      { _id: new ObjectId(userId), "demo_images.hash": hash },
      { projection: { "demo_images.$": 1 } },
    );
  return user?.demo_images?.[0] ?? null;
}

export async function appendDemoImage(
  userId: string,
  image: DemoImage,
): Promise<void> {
  const db = await getDb();
  await db.collection<User>(COLLECTION).updateOne(
    { _id: new ObjectId(userId) },
    { $push: { demo_images: image } },
  );
}

export async function appendGeneration(
  userId: string,
  generation: Generation,
): Promise<void> {
  const db = await getDb();
  await db.collection<User>(COLLECTION).updateOne(
    { _id: new ObjectId(userId) },
    { $push: { generations: generation } },
  );
}

export async function appendApiGeneration(
  userId: string,
  generation: Generation,
): Promise<void> {
  const db = await getDb();
  await db.collection<User>(COLLECTION).updateOne(
    { _id: new ObjectId(userId) },
    { $push: { api_generations: generation } },
  );
}

export async function setApiKeyHash(
  userId: string,
  apiKeyHash: string,
): Promise<void> {
  const db = await getDb();
  await db
    .collection<User>(COLLECTION)
    .updateOne({ _id: new ObjectId(userId) }, { $set: { apiKeyHash } });
}

// Used by api-auth to resolve an incoming `pwsk_…` key to a user. Needs an
// index on `apiKeyHash` (sparse) for sub-ms lookups at scale.
export async function findUserByApiKeyHash(
  apiKeyHash: string,
): Promise<User | null> {
  const db = await getDb();
  return db.collection<User>(COLLECTION).findOne({ apiKeyHash });
}

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

  const byGoogleId = await users.findOne({ googleId: input.googleId });
  if (byGoogleId) {
    const patch: Partial<User> = {};
    if (byGoogleId.email !== input.email) patch.email = input.email;
    if (byGoogleId.name !== input.name) patch.name = input.name;
    if (byGoogleId.image !== input.image) patch.image = input.image;
    if (Object.keys(patch).length > 0) {
      await users.updateOne({ _id: byGoogleId._id }, { $set: patch });
      return { ...byGoogleId, ...patch };
    }
    return byGoogleId;
  }

  // A magic-link-only user (googleId null) may already exist for this email.
  // Attach the googleId rather than create a duplicate.
  const byEmail = await users.findOne({ email: input.email.toLowerCase() });
  if (byEmail) {
    const patch: Partial<User> = { googleId: input.googleId };
    if (byEmail.name !== input.name) patch.name = input.name;
    if (byEmail.image !== input.image) patch.image = input.image;
    await users.updateOne({ _id: byEmail._id }, { $set: patch });
    return { ...byEmail, ...patch };
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

// Magic-link sign-in: find an existing user by email, or create one with no
// googleId. The user can later attach Google OAuth and the existing record is
// reused via `findOrCreateGoogleUser` (matched by email if googleId is null).
export async function findOrCreateByEmail(input: {
  email: string;
  name?: string;
}): Promise<User> {
  const db = await getDb();
  const users = db.collection<User>(COLLECTION);
  const email = input.email.toLowerCase().trim();

  const existing = await users.findOne({ email });
  if (existing) return existing;

  const doc: User = {
    googleId: null,
    email,
    name: input.name?.trim() || email.split("@")[0],
    image: null,
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

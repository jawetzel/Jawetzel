import { MongoClient, type Db } from "mongodb";

const uri = process.env.DATABASE_URL;
if (!uri) throw new Error("DATABASE_URL is not set in environment variables");

const DB_NAME = process.env.DATABASE_NAME || "portfoliowebsite";

const clientOptions = {
  maxPoolSize: 50,
  minPoolSize: 0,
};

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // Reuse connection across hot reloads so dev doesn't exhaust the pool.
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, clientOptions);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  const client = new MongoClient(uri, clientOptions);
  clientPromise = client.connect();
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(DB_NAME);
}

export default clientPromise;

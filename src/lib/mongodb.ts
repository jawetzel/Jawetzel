import { MongoClient, type Db } from "mongodb";
import { createReconnectSupervisor, type ReconnectSupervisor } from "./mongo-reconnect-supervisor";

/**
 * Process-singleton MongoClient — it owns the driver's connection pool, created once and reused.
 * Never hand-manage connections.
 *
 * SELF-HEALING. The driver recovers from almost everything on its own, but NOT from a failed
 * *initial* connect, and that one gap takes the whole process down until it is restarted. Verified
 * against mongodb@7.2.0:
 *
 *   1. `MongoClient._connect()` builds a Topology, and on failure closes it — but leaves it
 *      *assigned* to the client (mongo_client.js, `topologyConnect`'s catch).
 *   2. Every later operation goes through `autoConnect`, which short-circuits on
 *      `client.topology == null` (operations/execute_operation.js) — so it hands back the dead
 *      topology instead of reconnecting.
 *   3. A closed topology drains its wait queue with `MongoTopologyClosedError`
 *      (sdam/topology.js), forever. One transient TLS alert therefore fails every data-touching
 *      request from then on.
 *
 * Calling `connect()` again is the fix: `_connect()` rebuilds the topology whenever the existing
 * one isn't connected. It repairs the *same* client instance, and operations read
 * `client.topology` at call time — so every Db and Collection handle already handed out recovers
 * with it, and nothing downstream needs rebuilding.
 *
 * The trigger is the driver's own public `topologyClosed` event, NOT error sniffing at the call
 * sites. A blind retry wrapper around each call would paper over the dead topology rather than
 * rebuild it, and would fire on unrelated failures too.
 *
 * Caching the client rather than a `connect()` promise is load-bearing for that repair: a cached
 * promise that rejects stays rejected for the life of the process, so every later await fails and
 * no reconnect can reach it. The driver connects lazily on the first operation instead.
 */

/**
 * Held on globalThis, not in a module-scope `let`: a module-scope singleton is one per module
 * *evaluation*, and this module is re-evaluated on every hot reload — the dev server drops each
 * rebuilt server chunk out of `require.cache` (`deleteCache` in
 * next/dist/server/dev/require-cache.js, called from the hot reloader). A fresh `let` would
 * therefore build a second MongoClient with a second pool on every edit and leave the previous
 * one's sockets open, since nothing closes it — a few dozen edits exhaust the server's connection
 * limit. globalThis is not in that cache, so the pool outlives the reload. Next itself uses the
 * same escape hatch for its HMR handler registry, right beside the cache-clearing call.
 *
 * Not gated on NODE_ENV: the reload case is what makes it necessary, but a single pool per
 * process is what we want everywhere, and a gate is one more branch that only ever runs in dev.
 */
type MongoSingleton = { client: MongoClient; supervisor: ReconnectSupervisor };

const globalForMongo = globalThis as typeof globalThis & { __portfolioMongo?: MongoSingleton };

/** The Next.js server serves concurrent requests; the worker jobs are sequential. */
const clientOptions = {
  maxPoolSize: 50,
  minPoolSize: 0,
};

export function getMongoClient(): MongoClient {
  if (!globalForMongo.__portfolioMongo) {
    const uri = process.env.DATABASE_URL;
    if (!uri) throw new Error("DATABASE_URL is not set in environment variables");
    const created = new MongoClient(uri, clientOptions);
    const createdSupervisor = createReconnectSupervisor({
      connect: () => created.connect(),
      schedule: (run, delayMs) => {
        const timer: unknown = setTimeout(run, delayMs);
        // Node's Timeout — unref'd so a retry loop can never keep a one-off script or a
        // worker process alive on its own. Guarded rather than called directly because the
        // DOM lib types setTimeout as returning `number`.
        if (timer && typeof timer === "object" && "unref" in timer) {
          (timer as { unref: () => void }).unref();
        }
      },
      report: (event) => {
        if (event.kind === "scheduled") {
          console.error(
            `[mongodb] topology closed — reconnect attempt ${event.attempt} in ${event.delayMs}ms`,
          );
        } else if (event.kind === "failed") {
          console.error(`[mongodb] reconnect attempt ${event.attempt} failed:`, event.error);
        } else {
          console.error(`[mongodb] reconnected on attempt ${event.attempt}`);
        }
      },
    });
    // Bound to these locals, not the shared slot, so a client replaced by closeMongoClient()
    // can never be revived by its predecessor's listener.
    created.on("topologyClosed", () => createdSupervisor.notifyClosed());
    globalForMongo.__portfolioMongo = { client: created, supervisor: createdSupervisor };
  }
  return globalForMongo.__portfolioMongo.client;
}

/**
 * The application database.
 *
 * Async only because every call site awaits it — the driver connects on the first operation, so
 * there is nothing to wait for here. Keeping the signature keeps every caller unchanged.
 */
export async function getDb(): Promise<Db> {
  return getMongoClient().db(process.env.DATABASE_NAME || "portfoliowebsite");
}

/**
 * Deliberate shutdown, for one-off scripts. Stops the reconnect supervisor first, so closing on
 * purpose isn't mistaken for an incident and immediately reconnected.
 */
export async function closeMongoClient(): Promise<void> {
  const closing = globalForMongo.__portfolioMongo;
  closing?.supervisor.stop();
  globalForMongo.__portfolioMongo = undefined;
  await closing?.client.close();
}

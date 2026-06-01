import { deleteCached, getCached, setCached } from "@/lib/cache";
import { type Cache } from "@/application/ports/cache";

/**
 * MemTtlCache — the production {@link Cache}, a thin delegate over the existing
 * in-process TTL store in `src/lib/cache.ts`.
 *
 * **One shared store, by design.** Each method forwards to the module-level
 * `lib/cache` functions, which read and write the single `globalThis.__memCache`
 * map. This adapter deliberately does **not** create its own `Map`: the
 * still-flat consumers (`getCachedSession`'s `getCachedOrFetch`, the embroidery
 * in-flight locks) and the module-level `evictCachedApiKey` all touch that same
 * singleton, so a port-based write here and a flat read elsewhere stay fully
 * consistent. It is pure dependency inversion — no logic, no second store.
 *
 * Synchronous on purpose — see the {@link Cache} port note (the magic-link
 * atomic read-then-delete depends on it).
 *
 * See `docs/architecture/external-services.md` → Cache & rate limiting.
 */
export class MemTtlCache implements Cache {
  get<T>(key: string): T | null {
    return getCached<T>(key);
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    return setCached<T>(key, value, ttlMs);
  }

  delete(key: string): void {
    deleteCached(key);
  }
}

/**
 * Cache — a driven port for an in-memory, TTL-bounded key/value store.
 *
 * Consumer-owned: the use-case-side adapters that need a short-lived cache (the
 * API-key read-through cache, the magic-link token store) depend on this
 * capability, never on the concrete `globalThis` map. Named for the capability
 * (cache with a TTL), not the technology. The production adapter is
 * `infrastructure/cache/MemTtlCache`; tests use a small in-memory fake.
 *
 * **Synchronous by contract.** `get`/`set`/`delete` are intentionally sync, not
 * Promise-returning, because the magic-link single-use guarantee relies on a
 * read-then-delete that runs atomically w.r.t. the event loop (see
 * `InProcessMagicLinkTokens.consume`). An async port would break that
 * atomicity. A distributed (Redis) backing would need a different,
 * consumer-redefined port — this one models the in-process store the app uses
 * today. `ttlMs` is required: every migrated caller passes an explicit TTL, so
 * the port never leans on a default.
 *
 * See `docs/architecture/external-services.md` → Cache & rate limiting.
 */
export interface Cache {
  /** Return the cached value if present and unexpired, else `null`. */
  get<T>(key: string): T | null;
  /** Store `value` under `key` for `ttlMs` milliseconds; returns `value`. */
  set<T>(key: string, value: T, ttlMs: number): T;
  /** Remove `key` from the cache (no-op if absent). */
  delete(key: string): void;
}

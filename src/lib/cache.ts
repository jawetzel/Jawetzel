// In-memory TTL cache with in-flight dedup. Stored on globalThis so Next.js
// dev HMR doesn't reset it between module re-evaluations.

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface Entry<T> {
  data: T;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __memCache: Map<string, Entry<unknown>> | undefined;
  // eslint-disable-next-line no-var
  var __memCacheInflight: Map<string, Promise<unknown>> | undefined;
}

const store: Map<string, Entry<unknown>> =
  globalThis.__memCache ?? (globalThis.__memCache = new Map());

const inflight: Map<string, Promise<unknown>> =
  globalThis.__memCacheInflight ?? (globalThis.__memCacheInflight = new Map());

export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): T {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function deleteCached(key: string): void {
  store.delete(key);
}

// Return cached value if fresh, otherwise run fetcher once and cache it.
// Concurrent callers for the same key share the same in-flight promise.
export async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = fetcher()
    .then((data) => setCached(key, data, ttlMs))
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

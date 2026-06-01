import { type Cache } from "./cache";

/**
 * FakeCache — a synchronous, Map-backed {@link Cache} for tests. Each instance
 * owns its own store (no `globalThis`), so tests can't bleed into one another
 * through the shared production singleton. Honors `ttlMs` with a clock so expiry
 * can be asserted; defaults to `Date.now` when no clock is injected.
 */
export class FakeCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

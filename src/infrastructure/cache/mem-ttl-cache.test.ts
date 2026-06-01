import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemTtlCache } from "./mem-ttl-cache";

/**
 * MemTtlCache is a thin delegate over the real `lib/cache` globalThis store.
 * These tests exercise it through the production store (no mocks) to prove the
 * round-trip, the delete, the absent-key null, and that the TTL passed to `set`
 * actually bounds the entry (expiry → null). Unique keys per test avoid bleed
 * through the shared singleton.
 */
describe("MemTtlCache", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("set then get returns the stored value (delegates to the shared store)", () => {
    const cache = new MemTtlCache();
    const key = `memttl-test:roundtrip:${Math.random()}`;
    expect(cache.set(key, { hi: "there" }, 60_000)).toEqual({ hi: "there" });
    expect(cache.get<{ hi: string }>(key)).toEqual({ hi: "there" });
  });

  it("returns null for an absent key", () => {
    const cache = new MemTtlCache();
    expect(cache.get(`memttl-test:absent:${Math.random()}`)).toBeNull();
  });

  it("delete removes a previously set key", () => {
    const cache = new MemTtlCache();
    const key = `memttl-test:delete:${Math.random()}`;
    cache.set(key, 42, 60_000);
    expect(cache.get<number>(key)).toBe(42);
    cache.delete(key);
    expect(cache.get(key)).toBeNull();
  });

  it("respects the ttlMs argument — an entry past its TTL reads back null", () => {
    vi.useFakeTimers();
    const cache = new MemTtlCache();
    const key = `memttl-test:ttl:${Math.random()}`;
    cache.set(key, "soon-stale", 1_000);
    expect(cache.get<string>(key)).toBe("soon-stale");
    vi.advanceTimersByTime(1_001);
    expect(cache.get(key)).toBeNull();
  });
});

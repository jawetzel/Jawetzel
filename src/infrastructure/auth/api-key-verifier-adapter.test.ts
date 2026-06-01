import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeCache } from "@/application/ports/cache.fake";

/**
 * The verifier hashes with `NEXTAUTH_SECRET` and looks the user up via
 * `findUserByApiKeyHash`. We mock `@/lib/users` so no DB is touched (the real
 * module connects to Mongo at import), set a fixed secret so hashing is
 * deterministic, and inject a FakeCache so the read-through cache is asserted
 * without bleeding through the shared globalThis store.
 */
vi.mock("@/lib/users", () => ({
  findUserByApiKeyHash: vi.fn(),
}));

import { findUserByApiKeyHash } from "@/lib/users";
import {
  ApiKeyVerifierAdapter,
  apiKeyCacheKey,
  hashApiKey,
} from "./api-key-verifier-adapter";

const mockedFind = vi.mocked(findUserByApiKeyHash);

describe("ApiKeyVerifierAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret-for-hashing";
  });

  it("resolves a known key to its principal and writes it through to the cache", async () => {
    mockedFind.mockResolvedValue({
      _id: { toString: () => "user-123" },
      role: "user",
    } as never);

    const cache = new FakeCache();
    const adapter = new ApiKeyVerifierAdapter({ cache });

    const principal = await adapter.verify("pwsk_abc");
    expect(principal).toEqual({ userId: "user-123", role: "user" });

    // Written through under the apikey:<hash> key (20-min TTL — not asserted
    // here, but the same scheme the issuer evicts).
    const hash = hashApiKey("pwsk_abc");
    expect(cache.get(apiKeyCacheKey(hash))).toEqual({
      userId: "user-123",
      role: "user",
    });
  });

  it("serves a cache hit without touching the user lookup", async () => {
    const cache = new FakeCache();
    const hash = hashApiKey("pwsk_cached");
    cache.set(apiKeyCacheKey(hash), { userId: "u-9", role: "admin" }, 60_000);

    const adapter = new ApiKeyVerifierAdapter({ cache });
    const principal = await adapter.verify("pwsk_cached");

    expect(principal).toEqual({ userId: "u-9", role: "admin" });
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it("returns null when the key resolves to no user (and caches nothing)", async () => {
    mockedFind.mockResolvedValue(null);

    const cache = new FakeCache();
    const adapter = new ApiKeyVerifierAdapter({ cache });

    expect(await adapter.verify("pwsk_unknown")).toBeNull();
    const hash = hashApiKey("pwsk_unknown");
    expect(cache.get(apiKeyCacheKey(hash))).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  type UserRepository,
  type AuthUser,
} from "@/application/ports/user-repository";
import {
  type ApiKeyVerifier,
  type VerifiedApiKeyPrincipal,
} from "@/application/ports/api-key-verifier";
import { createIssueApiKey } from "./issue-api-key";

/**
 * Fakes for the two ports `IssueApiKey` owns. The repository records what hash
 * it was told to store; the verifier records hash/evict calls and produces a
 * deterministic, distinguishable hash so we can assert the HMAC (not the
 * plaintext) is persisted and that eviction targets the *previous* hash.
 */
class FakeUserRepository implements UserRepository {
  setCalls: Array<{ userId: string; hash: string }> = [];

  constructor(private previousHash: string | null = null) {}

  async findOrCreateByEmail(email: string): Promise<AuthUser> {
    return { id: "user_1", email, role: "user" };
  }
  async findOrCreateGoogleUser(): Promise<AuthUser> {
    return { id: "user_1", email: "unused@example.com", role: "user" };
  }
  async getApiKeyHash(): Promise<string | null> {
    return this.previousHash;
  }
  async setApiKeyHash(userId: string, hash: string): Promise<void> {
    this.setCalls.push({ userId, hash });
  }
}

class FakeApiKeyVerifier implements ApiKeyVerifier {
  hashed: string[] = [];
  evicted: string[] = [];

  async verify(): Promise<VerifiedApiKeyPrincipal | null> {
    return null;
  }
  hash(plaintext: string): string {
    this.hashed.push(plaintext);
    return `hash(${plaintext})`;
  }
  evict(hash: string): void {
    this.evicted.push(hash);
  }
}

describe("IssueApiKey", () => {
  it("returns a key with the pwsk_ prefix", async () => {
    const users = new FakeUserRepository();
    const apiKeys = new FakeApiKeyVerifier();

    const { apiKey } = await createIssueApiKey({ users, apiKeys }).execute({
      userId: "user_1",
    });

    expect(apiKey.startsWith("pwsk_")).toBe(true);
  });

  it("persists the HMAC of the generated key, never the plaintext", async () => {
    const users = new FakeUserRepository();
    const apiKeys = new FakeApiKeyVerifier();

    const { apiKey } = await createIssueApiKey({ users, apiKeys }).execute({
      userId: "user_1",
    });

    // The verifier hashed exactly the plaintext that was returned...
    expect(apiKeys.hashed).toEqual([apiKey]);
    // ...and the repository stored that hash, not the plaintext.
    expect(users.setCalls).toEqual([
      { userId: "user_1", hash: `hash(${apiKey})` },
    ]);
    expect(users.setCalls[0].hash).not.toBe(apiKey);
  });

  it("returns the plaintext that was generated", async () => {
    const users = new FakeUserRepository();
    const apiKeys = new FakeApiKeyVerifier();

    const { apiKey } = await createIssueApiKey({ users, apiKeys }).execute({
      userId: "user_1",
    });

    // Parity check: the persisted hash is the hash of the returned plaintext.
    expect(users.setCalls[0].hash).toBe(`hash(${apiKey})`);
  });

  it("on rotate, evicts the PREVIOUS hash (not the new one)", async () => {
    const users = new FakeUserRepository("old-hash");
    const apiKeys = new FakeApiKeyVerifier();

    await createIssueApiKey({ users, apiKeys }).execute({ userId: "user_1" });

    expect(apiKeys.evicted).toEqual(["old-hash"]);
  });

  it("does not evict when there was no previous hash", async () => {
    const users = new FakeUserRepository(null);
    const apiKeys = new FakeApiKeyVerifier();

    await createIssueApiKey({ users, apiKeys }).execute({ userId: "user_1" });

    expect(apiKeys.evicted).toEqual([]);
  });
});

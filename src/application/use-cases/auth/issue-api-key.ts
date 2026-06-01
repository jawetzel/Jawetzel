import { randomUUID } from "node:crypto";
import { type UserRepository } from "@/application/ports/user-repository";
import { type ApiKeyVerifier } from "@/application/ports/api-key-verifier";

/**
 * IssueApiKey — mint (or rotate) a per-user API key. Generates a fresh
 * `pwsk_<uuid>` plaintext, persists ONLY its HMAC (so the key is unrecoverable
 * after this call), evicts any previous hash from the verifier's cache so a
 * rotated key stops authenticating within seconds, and returns the plaintext to
 * be shown once. The `pwsk_` prefix is load-bearing — it's the discriminator
 * `AuthenticateRequest` checks before hitting the database, so it must stay
 * exact.
 *
 * Edge auth stays at the driving adapter: this use-case takes an
 * already-authenticated `userId`. Hashing and eviction go through the SAME
 * `ApiKeyVerifier` adapter the validator uses, so issuer and validator share
 * one `hashApiKey` and one cache-key scheme and can never diverge.
 */
export interface IssueApiKeyInput {
  userId: string;
}

export interface IssueApiKeyResult {
  apiKey: string;
}

export interface IssueApiKeyDeps {
  users: UserRepository;
  apiKeys: ApiKeyVerifier;
}

export interface IssueApiKey {
  execute(input: IssueApiKeyInput): Promise<IssueApiKeyResult>;
}

export function createIssueApiKey(deps: IssueApiKeyDeps): IssueApiKey {
  const { users, apiKeys } = deps;

  return {
    async execute({ userId }) {
      const previousHash = await users.getApiKeyHash(userId);

      const apiKey = `pwsk_${randomUUID()}`;
      await users.setApiKeyHash(userId, apiKeys.hash(apiKey));

      // Rotate: kill the old cached principal now, not after the 20-min TTL.
      if (previousHash) {
        apiKeys.evict(previousHash);
      }

      return { apiKey };
    },
  };
}

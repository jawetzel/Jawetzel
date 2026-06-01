/**
 * ApiKeyVerifier — a driven port for the per-user `pwsk_` API key, owning both
 * sides of the key's lifecycle the application touches: resolving a key to a
 * principal (the validator) and hashing/evicting a key (the issuer).
 *
 * Consumer-owned by two use-cases:
 *   - `AuthenticateRequest` calls `verify` — hands the verifier a raw key and
 *     gets back the owning user's `{ userId, role }` or `null` when the key
 *     resolves to no user. The use-case decides *whether* to call `verify`
 *     (only for keys with the `pwsk_` prefix — the discriminator that keeps
 *     shared-key requests from ever touching the database); the adapter owns
 *     the hashing, the read-through cache, and the user lookup.
 *   - `IssueApiKey` calls `hash` + `evict` — `hash` produces the value the
 *     issuer persists (never the plaintext); `evict` drops the *previous*
 *     hash's cache entry on rotate so the old key stops authenticating within
 *     seconds, not after the 20-min TTL.
 *
 * Both methods route through the SAME `hashApiKey` (HMAC-SHA256 keyed by
 * `NEXTAUTH_SECRET`) and the SAME `apiKeyCacheKey` scheme in the production
 * adapter (`ApiKeyVerifierAdapter`), so a rotate's `evict` targets the exact
 * cache entry `verify` writes — issuer and validator can never diverge. See
 * `docs/architecture/auth.md` → Key hashing.
 */
export interface VerifiedApiKeyPrincipal {
  userId: string;
  role: "user" | "admin";
}

export interface ApiKeyVerifier {
  /** Resolve a raw API key to its owning user's principal, or null. */
  verify(providedKey: string): Promise<VerifiedApiKeyPrincipal | null>;
  /** Hash a raw key for persistence — HMAC-SHA256, the value stored on the user. */
  hash(plaintext: string): string;
  /** Evict a hash's cache entry so a rotated/leaked key stops authenticating now. */
  evict(hash: string): void;
}

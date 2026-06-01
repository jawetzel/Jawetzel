import { createHmac } from "node:crypto";
import { deleteCached } from "@/lib/cache";
import { findUserByApiKeyHash } from "@/lib/users";
import { type Cache } from "@/application/ports/cache";
import {
  type ApiKeyVerifier,
  type VerifiedApiKeyPrincipal,
} from "@/application/ports/api-key-verifier";

/**
 * ApiKeyVerifierAdapter — the production {@link ApiKeyVerifier}, and the single
 * source of truth for per-user API-key hashing and caching.
 *
 * This module owns three things that the *issuer* (`/api-access` actions) and
 * the *validator* (the `requireAuth` shim) must agree on byte-for-byte:
 *   - `hashApiKey` — HMAC-SHA256 keyed with `NEXTAUTH_SECRET`. A leaked users
 *     collection is useless without the secret (defense in depth).
 *   - `apiKeyCacheKey` — the `apikey:<hash>` cache-key scheme.
 *   - `evictCachedApiKey` — drops the cache entry so a rotated key stops
 *     authenticating within seconds, not after the 20-min TTL.
 *
 * `src/lib/api-auth.ts` re-exports `hashApiKey` and `evictCachedApiKey` so the
 * issuer keeps importing them from there unchanged; both it and this verifier
 * resolve to the *same* functions, so they can never diverge.
 *
 * See `docs/architecture/auth.md` → Key hashing.
 */
const API_KEY_TTL_MS = 20 * 60 * 1000;

export const apiKeyCacheKey = (hash: string): string => `apikey:${hash}`;

// HMAC-SHA256 with NEXTAUTH_SECRET as the key. Single source of truth for
// hashing per-user API keys — the issuer (api-access actions) and the
// validator (this verifier) must agree byte-for-byte.
export function hashApiKey(key: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return createHmac("sha256", secret).update(key).digest("hex");
}

// Exposed so the issuer (api-access actions) can evict on rotate — the old
// hash must die within seconds, not after the 20-min TTL elapses. Stays a
// module-level function (the issuer imports it via the `api-auth` re-export, not
// through the container) and deletes straight from the shared `lib/cache`
// singleton. Because `MemTtlCache` delegates to that same singleton, the
// injected `cache.delete` below and this `evictCachedApiKey` hit the *one*
// store — a rotated key is evicted from the exact entry the verifier wrote.
export function evictCachedApiKey(hash: string): void {
  deleteCached(apiKeyCacheKey(hash));
}

export class ApiKeyVerifierAdapter implements ApiKeyVerifier {
  constructor(private readonly deps: { cache: Cache }) {}

  // Issuer side. `hash` is the SAME `hashApiKey` the validator uses below, so
  // the value persisted on the user matches what `verify` looks up. `evict`
  // drops the cache entry through the injected `Cache` port — the same store
  // `verify` writes to (and the same store the module-level `evictCachedApiKey`
  // hits) — so a rotated key stops authenticating within seconds.
  hash(plaintext: string): string {
    return hashApiKey(plaintext);
  }

  evict(hash: string): void {
    this.deps.cache.delete(apiKeyCacheKey(hash));
  }

  async verify(providedKey: string): Promise<VerifiedApiKeyPrincipal | null> {
    const hash = hashApiKey(providedKey);
    const cacheKey = apiKeyCacheKey(hash);

    const cached = this.deps.cache.get<VerifiedApiKeyPrincipal>(cacheKey);
    if (cached) return cached;

    const user = await findUserByApiKeyHash(hash);
    if (!user?._id) return null;

    const principal: VerifiedApiKeyPrincipal = {
      userId: user._id.toString(),
      role: user.role,
    };
    this.deps.cache.set(cacheKey, principal, API_KEY_TTL_MS);
    return principal;
  }
}

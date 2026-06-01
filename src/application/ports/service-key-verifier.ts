/**
 * ServiceKeyVerifier — a driven port for the shared, per-surface env-var key
 * (server-to-server / admin).
 *
 * Consumer-owned: `AuthenticateRequest` asks whether a provided key matches the
 * shared secret for a given surface, identified by its env-var name. The match
 * is true *only* when both the expected (env) and provided values are non-empty
 * and equal — so a missing env var or an empty header can never authenticate.
 *
 * Env access and the constant-time comparison (`timingSafeEqual` over SHA-256
 * digests) live in the adapter, never in the use-case. Per-surface env vars
 * keep blast radius small — a leaked key unlocks one surface, not all of them.
 * See `docs/architecture/auth.md` → Per-surface keys.
 */
export interface ServiceKeyVerifier {
  /** True iff the shared key for `apiKeyEnvVar` is set and equals `providedKey`. */
  matches(providedKey: string, apiKeyEnvVar: string): boolean;
}

import { createHash, timingSafeEqual } from "node:crypto";
import { type ServiceKeyVerifier } from "@/application/ports/service-key-verifier";

/**
 * ServiceKeyVerifierAdapter — the production {@link ServiceKeyVerifier}.
 *
 * Reads the shared secret for a surface from `process.env[apiKeyEnvVar]` and
 * compares it to the provided key with `timingSafeEqual` over SHA-256 digests
 * (constant-time, no length/early-mismatch leak). Matches *only* when both the
 * expected and provided values are non-empty — a missing env var or an empty
 * header can never authenticate. Env access and crypto live here, never in the
 * use-case. See `docs/architecture/auth.md` → Key hashing.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export class ServiceKeyVerifierAdapter implements ServiceKeyVerifier {
  matches(providedKey: string, apiKeyEnvVar: string): boolean {
    const expected = process.env[apiKeyEnvVar];
    return Boolean(expected && providedKey && safeEqual(providedKey, expected));
  }
}

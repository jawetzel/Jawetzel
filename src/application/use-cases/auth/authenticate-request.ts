import { type AuthPrincipal } from "@/domain/auth/principal";
import { ok, err, type Result } from "@/domain/shared/result";
import { type SessionGateway } from "@/application/ports/session-gateway";
import { type ApiKeyVerifier } from "@/application/ports/api-key-verifier";
import { type ServiceKeyVerifier } from "@/application/ports/service-key-verifier";

/**
 * AuthenticateRequest — resolve a gated request to exactly one of three
 * principals, in a strictly load-bearing order:
 *
 *   1. SESSION (signed-in browser) — cheapest, cached; wins even if a key is
 *      also present on the request.
 *   2. PER-USER API KEY — *only* when the provided key carries the `pwsk_`
 *      prefix (the discriminator that keeps shared-key requests from ever
 *      hitting the database). A `pwsk_` key that resolves to no user is
 *      UNAUTHORIZED and does **not** fall through to the service path.
 *   3. SHARED ENV KEY (server-to-server / admin) — only reached for a
 *      non-`pwsk_` key; resolves to `{ userId: null, role: "service" }`.
 *
 * Anything else is UNAUTHORIZED. This is the exact behavior of the former
 * `requireAuth`, now testable with fakes (no cookies, no DB, no env). The
 * structural parse of the provided key happens at the driving edge (the
 * `requireAuth` shim); this use-case takes the already-extracted key.
 *
 * See `docs/architecture/auth.md` for the three-actor model.
 */
export type AuthenticateError = "UNAUTHORIZED";

export interface AuthenticateRequestInput {
  /** The raw key extracted from `x-api-key` / `Authorization`, or "" if none. */
  providedKey: string;
  /** Env-var name holding the shared key for this surface (e.g. EMBROIDERY_API_KEY). */
  apiKeyEnvVar: string;
}

export interface AuthenticateRequestDeps {
  session: SessionGateway;
  apiKey: ApiKeyVerifier;
  serviceKey: ServiceKeyVerifier;
}

export interface AuthenticateRequest {
  execute(
    input: AuthenticateRequestInput,
  ): Promise<Result<AuthPrincipal, AuthenticateError>>;
}

export function createAuthenticateRequest(
  deps: AuthenticateRequestDeps,
): AuthenticateRequest {
  const { session, apiKey, serviceKey } = deps;

  return {
    async execute({ providedKey, apiKeyEnvVar }) {
      // 1. Session-cookie path (browser, signed-in user). Wins outright.
      const sessionPrincipal = await session.getCurrentPrincipal();
      if (sessionPrincipal) {
        return ok({
          userId: sessionPrincipal.userId,
          role: sessionPrincipal.role,
        });
      }

      // 2. Per-user API key path. The `pwsk_` prefix is the discriminator —
      // keeps env-var keys (which don't use the prefix) from hitting the DB.
      // A `pwsk_` key that fails to resolve does NOT fall through to (3).
      if (providedKey.startsWith("pwsk_")) {
        const principal = await apiKey.verify(providedKey);
        if (principal) {
          return ok({ userId: principal.userId, role: principal.role });
        }
        return err("UNAUTHORIZED");
      }

      // 3. Shared-key path (server-to-server). No userId; synthetic "service".
      if (serviceKey.matches(providedKey, apiKeyEnvVar)) {
        return ok({ userId: null, role: "service" });
      }

      return err("UNAUTHORIZED");
    },
  };
}

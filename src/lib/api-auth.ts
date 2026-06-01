import { createContainer } from "@/composition/container";
import { type AuthPrincipal } from "@/domain/auth/principal";
import { isOk } from "@/domain/shared/result";

// AuthPrincipal now lives in the domain; re-exported here so existing
// consumers (and the embroidery `_lib/auth.ts` re-export) keep importing it
// from `@/lib/api-auth` unchanged.
export type { AuthPrincipal };

// (The `hashApiKey` / `evictCachedApiKey` / `apiKeyCacheKey` re-exports were
// removed once the issuer migrated to `IssueApiKey`: the issuer no longer
// imports them from here, and they remain the single source of truth inside
// `ApiKeyVerifierAdapter`, now reached through the `ApiKeyVerifier` port's
// `hash` / `evict` methods. Validator and issuer still resolve to the same
// functions, so they can never diverge.)

// Thin driving-edge shim. It does the *structural* parse (pull the provided key
// off the headers), delegates the three-path auth *decision* to the
// `AuthenticateRequest` use-case, and maps the Result back to the historical
// `Response | AuthPrincipal` contract so all 13 route-handler consumers and the
// embroidery `_lib/auth.ts` wrapper stay byte-for-byte unchanged.
//
// Accepts ONE OF (decided inside the use-case, in this order):
//   1. NextAuth session cookie (signed-in browser).
//   2. Per-user API key (`pwsk_<uuid>`) — resolves to that user's userId/role.
//   3. Shared env-var key (`apiKeyEnvVar`) — server-to-server, role "service",
//      no userId (caller must reject if it needs a user).
// On any failure: the same 401 `Response.json({ error: "Unauthorized" })`.
//
// `apiKeyEnvVar` selects which env var holds the shared key for this surface
// (e.g. `EMBROIDERY_API_KEY`). Per-surface keys keep blast radius small.
export async function requireAuth(
  request: Request,
  apiKeyEnvVar: string,
): Promise<Response | AuthPrincipal> {
  const providedKey =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  const result = await createContainer().authenticateRequest.execute({
    providedKey,
    apiKeyEnvVar,
  });

  if (isOk(result)) return result.value;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getCachedSession } from "@/lib/auth";
import { deleteCached, getCached, setCached } from "@/lib/cache";
import { findUserByApiKeyHash } from "@/lib/users";

const API_KEY_TTL_MS = 20 * 60 * 1000;
const apiKeyCacheKey = (hash: string) => `apikey:${hash}`;

// Exposed so the issuer (api-access actions) can evict on rotate — the old
// hash must die within seconds, not after the 20-min TTL elapses.
export function evictCachedApiKey(hash: string): void {
  deleteCached(apiKeyCacheKey(hash));
}

type CachedPrincipal = { userId: string; role: "user" | "admin" };

async function resolveApiKey(plaintext: string): Promise<CachedPrincipal | null> {
  const hash = hashApiKey(plaintext);
  const cacheKey = apiKeyCacheKey(hash);

  const cached = getCached<CachedPrincipal>(cacheKey);
  if (cached) return cached;

  const user = await findUserByApiKeyHash(hash);
  if (!user?._id) return null;

  const principal: CachedPrincipal = {
    userId: user._id.toString(),
    role: user.role,
  };
  setCached(cacheKey, principal, API_KEY_TTL_MS);
  return principal;
}

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

// HMAC-SHA256 with NEXTAUTH_SECRET as the key. Single source of truth for
// hashing per-user API keys — the issuer (api-access actions) and the
// validator (here) must agree byte-for-byte. Defense in depth: a leaked
// users collection is useless to an attacker without the secret too.
export function hashApiKey(key: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return createHmac("sha256", secret).update(key).digest("hex");
}

export type AuthPrincipal = {
  userId: string | null;
  role: "user" | "admin" | "service";
};

// Accepts ONE OF:
//   1. NextAuth session cookie (signed-in browser).
//   2. Per-user API key (`pwsk_<uuid>`) — issued from /api-access. Resolves
//      to that user's `userId` and role.
//   3. Shared env-var key — server-to-server / admin. Returns role "service"
//      with no userId (caller must reject if it needs a user).
//
// Returns a Response on failure, or a principal on success. Session path is
// cached (see getCachedSession) so repeated API calls from a signed-in
// browser don't each pay the JWT verify cost.
//
// `apiKeyEnvVar` selects which env var holds the shared key for this surface
// (e.g. `EMBROIDERY_API_KEY`). Per-surface keys keep blast radius small.
export async function requireAuth(
  request: Request,
  apiKeyEnvVar: string,
): Promise<Response | AuthPrincipal> {
  // 1. Session-cookie path (browser, signed-in user).
  const session = await getCachedSession();
  if (session?.user?.id) {
    return { userId: session.user.id, role: session.user.role };
  }

  const provided =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  // 2. Per-user API key path. Prefix is the discriminator — keeps env-var
  // keys (which don't use the prefix) from accidentally hitting the DB.
  // Result is cached for 20 minutes keyed on the hash, mirroring the session
  // cache pattern so repeated calls from a single key are cheap.
  if (provided.startsWith("pwsk_")) {
    const principal = await resolveApiKey(provided);
    if (principal) return principal;
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Shared-key path (server-to-server).
  const expected = process.env[apiKeyEnvVar];
  if (expected && provided && safeEqual(provided, expected)) {
    return { userId: null, role: "service" };
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

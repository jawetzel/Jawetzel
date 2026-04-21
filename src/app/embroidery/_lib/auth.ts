import { createHash, timingSafeEqual } from "node:crypto";
import { getCachedSession } from "@/lib/auth";

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export type AuthPrincipal = {
  userId: string | null;
  role: "user" | "admin" | "service";
};

// Accepts EITHER a NextAuth session (cookie from a signed-in browser) OR the
// shared EMBROIDERY_API_KEY (server-to-server / admin). Returns a Response on
// failure, or a principal on success. Session path is cached (see
// getCachedSession) so repeated API calls from a signed-in browser don't each
// pay the JWT verify cost.
export async function requireAuth(
  request: Request,
): Promise<Response | AuthPrincipal> {
  // 1. Session-cookie path (browser, signed-in user).
  const session = await getCachedSession();
  if (session?.user?.id) {
    return { userId: session.user.id, role: session.user.role };
  }

  // 2. Shared-key path (server-to-server). X-API-Key or Authorization: Bearer.
  const expected = process.env.EMBROIDERY_API_KEY;
  const provided =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (expected && provided && safeEqual(provided, expected)) {
    return { userId: null, role: "service" };
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

import { createHash, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

// Gate every /embroidery/api/* route behind EMBROIDERY_API_KEY. Fail-closed:
// if the env var is unset we return 500 instead of letting traffic through,
// so a mis-deployed instance can never accidentally expose these endpoints.
// Accepts the key via `X-API-Key: <key>` or `Authorization: Bearer <key>`.
export function requireAuth(request: Request): Response | null {
  const expected = process.env.EMBROIDERY_API_KEY;
  if (!expected) {
    return Response.json(
      { error: "API not configured: EMBROIDERY_API_KEY is unset" },
      { status: 500 },
    );
  }
  const provided =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!provided || !safeEqual(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

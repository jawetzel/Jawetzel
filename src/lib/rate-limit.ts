import { NextResponse } from "next/server";

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

export function checkRateLimit(
  storeName: string,
  key: string,
  rule: RateLimitRule
): { ok: true } | { ok: false; retryAfterMs: number } {
  if (!stores.has(storeName)) {
    stores.set(storeName, new Map());
  }
  const store = stores.get(storeName)!;

  const now = Date.now();
  const cutoff = now - rule.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= rule.limit) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = oldest + rule.windowMs - now;
    return { ok: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { ok: true };
}

export function rateLimitResponse(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "TOO_MANY_REQUESTS", retryAfterMs },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    }
  );
}

export function getClientIp(request: {
  headers: { get(name: string): string | null };
}): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

import { NextResponse } from "next/server";
import {
  checkRateLimit,
  rateLimitResponse,
  getClientIp,
} from "@/lib/rate-limit";

type RouteHandler = (
  request: Request,
  context?: unknown
) => Promise<NextResponse | Response>;

export function apiError(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function apiSuccess(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function withRateLimit(
  storeName: string,
  limit: number,
  windowMs: number,
  handler: RouteHandler
): RouteHandler {
  return async (request, context) => {
    const ip = getClientIp(request);
    const result = checkRateLimit(storeName, ip, { limit, windowMs });
    if (!result.ok) {
      return rateLimitResponse(result.retryAfterMs);
    }
    return handler(request, context);
  };
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const appUrl = process.env.APP_URL;
  if (!appUrl) return true;
  const candidates = [origin, referer].filter(Boolean) as string[];
  if (candidates.length === 0) return false;
  try {
    const expected = new URL(appUrl).origin;
    return candidates.some((c) => {
      try {
        return new URL(c).origin === expected;
      } catch {
        return false;
      }
    });
  } catch {
    return true;
  }
}

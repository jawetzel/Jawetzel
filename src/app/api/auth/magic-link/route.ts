import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { createContainer } from "@/composition/container";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Thin driving adapter: rate-limit + *structural* email/callbackUrl validation
 * here; the mint-and-send is the RequestMagicLink use-case. The response is
 * always `{ ok: true }` regardless of outcome and errors are logged, never
 * bubbled — this prevents email enumeration via response shape or timing.
 */
export async function POST(request: NextRequest) {
  const rl = checkRateLimit("magic-link", getClientIp(request), {
    limit: 3,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);

  let body: { email?: unknown; callbackUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }

  const callbackUrl =
    typeof body.callbackUrl === "string" && body.callbackUrl.startsWith("/")
      ? body.callbackUrl
      : undefined;

  try {
    await createContainer().requestMagicLink.execute({ email, callbackUrl });
  } catch (err) {
    console.error("[magic-link] send failed:", err);
  }

  return NextResponse.json({ ok: true });
}

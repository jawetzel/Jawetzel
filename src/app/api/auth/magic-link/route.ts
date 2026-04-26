import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { sendMagicLink } from "@/lib/magic-link";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Always return ok regardless of whether the email is on file. The
  // auto-provision step in sendMagicLink also writes a user record, so the
  // first sign-in attempt for a new email simply creates the account.
  // Errors are logged but never bubbled — this prevents email enumeration
  // via response timing or shape differences.
  try {
    await sendMagicLink(email, callbackUrl);
  } catch (err) {
    console.error("[magic-link] send failed:", err);
  }

  return NextResponse.json({ ok: true });
}

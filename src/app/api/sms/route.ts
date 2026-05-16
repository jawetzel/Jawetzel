import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { withRateLimit, apiSuccess, apiError } from "@/lib/api-helpers";
import { RATE_LIMITS } from "@/lib/constants";
import { sendSms } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_MAX = 1000;

export const POST = withRateLimit(
  "sms",
  RATE_LIMITS.sms.limit,
  RATE_LIMITS.sms.windowMs,
  async (request: Request) => {
    // Shared env-var key (SMS_API_KEY) -> role "service", or an admin session.
    const auth = await requireAuth(request, "SMS_API_KEY");
    if (auth instanceof Response) return auth;
    if (auth.role !== "service" && auth.role !== "admin") {
      return apiError("Forbidden.", 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await (request as NextRequest).json();
    } catch {
      return apiError("Invalid request body.", 400);
    }

    const to = typeof body.to === "string" ? body.to.trim() : "";
    const content =
      typeof body.content === "string" ? body.content.trim() : "";

    if (!to) return apiError("`to` is required.", 400);
    if (!content) return apiError("`content` is required.", 400);
    if (content.length > CONTENT_MAX) {
      return apiError(`\`content\` exceeds ${CONTENT_MAX} chars.`, 400);
    }

    try {
      const result = await sendSms({ to, content });
      return apiSuccess({ ok: true, ...result });
    } catch (err) {
      console.error("[sms] send failed:", err);
      return apiError(
        err instanceof Error ? err.message : "Failed to send SMS.",
        502,
      );
    }
  },
);

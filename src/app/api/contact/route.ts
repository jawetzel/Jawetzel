import { NextRequest } from "next/server";
import {
  withRateLimit,
  apiSuccess,
  apiError,
  isSameOrigin,
} from "@/lib/api-helpers";
import { RATE_LIMITS } from "@/lib/constants";
import { createContainer } from "@/composition/container";

export const runtime = "nodejs";

const OPTIONAL_MAX = 120;
const MESSAGE_MAX = 5000;

function clean(s: unknown, max = OPTIONAL_MAX): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

/**
 * Thin driving adapter: rate-limit + origin + bot honeypot + *structural*
 * sanitization (trim/clamp) happen here; everything else is the
 * SubmitContactInquiry use-case. Business validation lives in the domain value
 * object; this handler only maps the use-case's Result back onto the HTTP
 * responses the form has always received, and logs once at the boundary.
 */
export const POST = withRateLimit(
  "contact",
  RATE_LIMITS.contact.limit,
  RATE_LIMITS.contact.windowMs,
  async (request: Request) => {
    if (!isSameOrigin(request)) {
      return apiError("Forbidden origin.", 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await (request as NextRequest).json();
    } catch {
      return apiError("Invalid request body.", 400);
    }

    // Honeypot — silently succeed so bots don't retry
    if (clean(body.website, 200)) {
      return apiSuccess({ ok: true });
    }

    const { submitContactInquiry } = createContainer();
    const result = await submitContactInquiry.execute({
      name: clean(body.name),
      email: clean(body.email),
      message: clean(body.message, MESSAGE_MAX),
      projectType: clean(body.projectType),
      timeline: clean(body.timeline),
    });

    if (!result.ok) {
      switch (result.error.code) {
        case "MISSING_FIELDS":
          return apiError("Name, email, and message are required.", 400);
        case "INVALID_EMAIL":
          return apiError("Please provide a valid email address.", 400);
        case "MESSAGE_TOO_SHORT":
          return apiError("Message is too short.", 400);
        case "OWNER_SEND_FAILED":
          console.error(
            "[contact] owner notification failed:",
            result.error.cause,
          );
          return apiError(
            "Failed to send your message. Please try again, or email me directly.",
            502,
          );
      }
    }

    // Auto-response is best-effort: if it failed, the inquiry still went through
    if (!result.value.autoResponseSent) {
      console.warn(
        "[contact] auto-response failed:",
        result.value.autoResponseError,
      );
    }

    return apiSuccess({ ok: true });
  },
);

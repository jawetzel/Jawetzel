import { NextRequest } from "next/server";
import {
  withRateLimit,
  apiSuccess,
  apiError,
  isSameOrigin,
} from "@/lib/api-helpers";
import { RATE_LIMITS } from "@/lib/constants";
import {
  sendContactInquiryToOwner,
  sendContactAutoResponse,
} from "@/lib/email";

export const runtime = "nodejs";

const OPTIONAL_MAX = 120;
const MESSAGE_MAX = 5000;

function clean(s: unknown, max = OPTIONAL_MAX): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

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

    const name = clean(body.name);
    const email = clean(body.email);
    const message = clean(body.message, MESSAGE_MAX);
    const projectType = clean(body.projectType);
    const timeline = clean(body.timeline);

    if (!name || !email || !message) {
      return apiError("Name, email, and message are required.", 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError("Please provide a valid email address.", 400);
    }
    if (message.length < 2) {
      return apiError("Message is too short.", 400);
    }

    try {
      await sendContactInquiryToOwner({
        name,
        email,
        message,
        projectType: projectType || undefined,
        timeline: timeline || undefined,
      });
    } catch (err) {
      console.error("[contact] owner notification failed:", err);
      return apiError(
        "Failed to send your message. Please try again, or email me directly.",
        502
      );
    }

    // Auto-response is best-effort: if it fails, the inquiry still went through
    try {
      await sendContactAutoResponse(name, email);
    } catch (err) {
      console.warn("[contact] auto-response failed:", err);
    }

    return apiSuccess({ ok: true });
  }
);

/**
 * POST /api/chat — send a message.
 *
 * Anon and authed flow through the same handler. First call (no
 * `conversationId` in the body) creates a conversation; subsequent calls
 * append to the supplied id.
 *
 * Rate limit is per-message: 10 / 30 min for anon (keyed by IP), 30 / 60
 * min for authed (keyed by user id).
 *
 * Request body:
 *   {
 *     message: string,
 *     pageUrl: string,
 *     conversationId?: string  // omit on first message
 *   }
 *
 * Response 200:
 *   {
 *     conversationId: string,
 *     userMessage:    ConversationMessage,
 *     assistantMessage: ConversationMessage,
 *     title?: string  // set on the first turn after we summarize
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { getCachedSession } from "@/lib/auth";
import { apiError, isSameOrigin } from "@/lib/api-helpers";
import { RATE_LIMITS } from "@/lib/constants";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  appendMessage,
  createConversation,
  getAnonConversation,
  getConversationForUser,
  type ConversationDoc,
  type ConversationMessage,
} from "@/lib/ai/conversations";
import { runAssistantTurn, summarizeAndSetTitle } from "@/lib/ai/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 4000;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return apiError("Forbidden origin.", 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl : "";
  const conversationIdRaw =
    typeof body.conversationId === "string" ? body.conversationId : null;

  if (!message) return apiError("Message is required.", 400);
  if (message.length > MAX_MESSAGE_CHARS) {
    return apiError(
      `Message exceeds ${MAX_MESSAGE_CHARS} character limit.`,
      400,
    );
  }

  const session = await getCachedSession();
  const userIdStr = session?.user?.id ?? null;
  const userObjectId = userIdStr ? new ObjectId(userIdStr) : null;
  const ip = getClientIp(request);

  // Rate limit — separate buckets for anon vs authed, different keys.
  const rule = userIdStr ? RATE_LIMITS.chatAuthed : RATE_LIMITS.chatAnon;
  const rlKey = userIdStr ?? ip;
  const rl = checkRateLimit(
    userIdStr ? "chat-authed" : "chat-anon",
    rlKey,
    rule,
  );
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);

  // Resolve conversation — create one if none supplied or look up + authorize.
  let conversation: ConversationDoc & { _id: ObjectId };
  let isFirstMessage = false;

  if (conversationIdRaw) {
    let id: ObjectId;
    try {
      id = new ObjectId(conversationIdRaw);
    } catch {
      return apiError("Invalid conversationId.", 400);
    }

    if (userObjectId) {
      const existing = await getConversationForUser(id, userObjectId);
      if (!existing) return apiError("Conversation not found.", 404);
      conversation = existing;
    } else {
      // Anon can only write to an anon doc. Guards against a logged-in
      // user's id leaking into an anon client's localStorage.
      const existing = await getAnonConversation(id);
      if (!existing) return apiError("Conversation not found.", 404);
      conversation = existing;
    }
  } else {
    conversation = await createConversation({
      ...(userObjectId && { userId: userObjectId }),
      startPageUrl: pageUrl || undefined,
      ...(userObjectId
        ? {}
        : {
            ipAddress: ip,
            userAgent: request.headers.get("user-agent") ?? undefined,
          }),
    });
    isFirstMessage = true;
  }

  const now = new Date();
  const userMessage: ConversationMessage = {
    role: "user",
    content: message,
    ...(pageUrl && { pageUrl }),
    createdAt: now,
  };
  await appendMessage(conversation._id, userMessage);

  const history = [...conversation.messages, userMessage];

  let assistantMessage: ConversationMessage;
  try {
    assistantMessage = await runAssistantTurn({
      conversationId: conversation._id,
      history,
      pageUrl,
    });
  } catch (err) {
    console.error("[chat] assistant turn failed:", err);
    return apiError(
      "Assistant call failed. Try again in a moment.",
      502,
    );
  }

  // Title the convo on the first real exchange. Inline (blocks response by
  // ~500ms) but keeps the client rendering the title immediately.
  let title: string | undefined;
  if (isFirstMessage) {
    try {
      title = await summarizeAndSetTitle({
        conversationId: conversation._id,
        userText: message,
        assistantText: assistantMessage.content,
      });
    } catch (err) {
      console.error("[chat] title summary failed:", err);
    }
  }

  return NextResponse.json({
    conversationId: conversation._id.toString(),
    userMessage,
    assistantMessage,
    ...(title && { title }),
  });
}

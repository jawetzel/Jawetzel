/**
 * POST /api/chat/claim — adopt an anon conversation into the signed-in
 * user's account.
 *
 * Call site: the chat UI, right after a successful sign-in, if an anon
 * `conversationId` is present in localStorage. If the id still points to
 * an un-claimed anon doc, we set `userId` on it and the client promotes
 * it into the authed thread list. If it was already claimed by someone
 * else (shouldn't happen in practice) or doesn't exist, we return
 * { claimed: false } — the client then clears localStorage.
 *
 * Request body: { conversationId: string }
 * Response 200: { claimed: boolean }
 */

import { NextResponse, type NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { getCachedSession } from "@/lib/auth";
import { apiError, isSameOrigin } from "@/lib/api-helpers";
import { claimAnon } from "@/lib/ai/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return apiError("Forbidden origin.", 403);

  const session = await getCachedSession();
  if (!session?.user?.id) return apiError("Sign in required.", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const conversationIdRaw =
    typeof body.conversationId === "string" ? body.conversationId : "";
  if (!conversationIdRaw) return apiError("conversationId is required.", 400);

  let conversationId: ObjectId;
  try {
    conversationId = new ObjectId(conversationIdRaw);
  } catch {
    return apiError("Invalid conversationId.", 400);
  }

  const userId = new ObjectId(session.user.id);
  const claimed = await claimAnon(conversationId, userId);

  return NextResponse.json({ claimed });
}

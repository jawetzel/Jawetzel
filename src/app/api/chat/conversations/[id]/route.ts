/**
 * GET    /api/chat/conversations/[id] — full conversation.
 *   - Anon: allowed only if the doc has no userId (unclaimed). This is how
 *     anon visitors restore their in-flight thread on navigation. The id
 *     is a 24-hex ObjectId, effectively unguessable, held only in the
 *     visitor's own localStorage.
 *   - Authed: requires ownership.
 * DELETE /api/chat/conversations/[id] — authed, owner only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { getCachedSession } from "@/lib/auth";
import { apiError } from "@/lib/api-helpers";
import {
  deleteConversationForUser,
  getAnonConversation,
  getConversationForUser,
} from "@/lib/ai/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): ObjectId | null {
  try {
    return new ObjectId(raw);
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) return apiError("Invalid conversation id.", 400);

  const session = await getCachedSession();
  const userIdStr = session?.user?.id ?? null;

  const doc = userIdStr
    ? await getConversationForUser(id, new ObjectId(userIdStr))
    : await getAnonConversation(id);
  if (!doc) return apiError("Conversation not found.", 404);

  return NextResponse.json({
    id: doc._id.toString(),
    title: doc.title,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    messages: doc.messages.map((m) => ({
      role: m.role,
      content: m.content,
      pageUrl: m.pageUrl,
      toolResults: m.toolResults,
      createdAt:
        m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
    })),
  });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCachedSession();
  if (!session?.user?.id) return apiError("Sign in required.", 401);

  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) return apiError("Invalid conversation id.", 400);

  const userId = new ObjectId(session.user.id);
  const ok = await deleteConversationForUser(id, userId);
  if (!ok) return apiError("Conversation not found.", 404);

  return NextResponse.json({ ok: true });
}

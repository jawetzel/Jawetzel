/**
 * GET /api/chat/conversations — paginated list of the signed-in user's
 * chat threads (metadata only — no messages). Anon users get 401: their
 * convos exist for analytics only and have no read-back UI.
 *
 * Query params:
 *   page     (default 1)
 *   perPage  (default 10, max 50)
 */

import { NextResponse, type NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { getCachedSession } from "@/lib/auth";
import { apiError } from "@/lib/api-helpers";
import {
  DEFAULT_CONVERSATIONS_PER_PAGE,
  listConversationsForUser,
} from "@/lib/ai/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_PAGE = 50;

export async function GET(request: NextRequest) {
  const session = await getCachedSession();
  if (!session?.user?.id) return apiError("Sign in required.", 401);

  const userId = new ObjectId(session.user.id);
  const { searchParams } = new URL(request.url);

  const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
  const perPageRaw = parseInt(
    searchParams.get("perPage") ?? String(DEFAULT_CONVERSATIONS_PER_PAGE),
    10,
  );
  const page = Number.isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);
  const perPage = Number.isNaN(perPageRaw)
    ? DEFAULT_CONVERSATIONS_PER_PAGE
    : Math.min(MAX_PER_PAGE, Math.max(1, perPageRaw));

  const result = await listConversationsForUser(userId, page, perPage);

  return NextResponse.json({
    items: result.items.map((it) => ({
      id: it._id.toString(),
      title: it.title,
      createdAt: it.createdAt.toISOString(),
      updatedAt: it.updatedAt.toISOString(),
    })),
    total: result.total,
    page: result.page,
    perPage: result.perPage,
    hasMore: result.page * result.perPage < result.total,
  });
}

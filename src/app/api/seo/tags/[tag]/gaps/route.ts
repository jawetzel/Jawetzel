import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import {
  isRecord,
  stringArray,
} from "@/application/use-cases/seo/request-fields";
import { type GapStatus } from "@/domain/seo/gap-pile";

/**
 * `/api/seo/tags/[tag]/gaps` — the gap pile, and its gate.
 *
 * GET   — the pile, ranked, optionally filtered by `bucket` and `status`.
 * PATCH — accept or reject keywords: `{ keywords: [...], status: "accepted" }`.
 *
 * Hung off the **tag**, not a run, because the pile is property-scoped and
 * merges across runs. A keyword rejected today must stay rejected when layer 2
 * is re-pulled next quarter, which only works if the decision lives where the
 * keyword does.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: GapStatus[] = ["new", "accepted", "rejected"];
const BUCKETS = ["improve", "gap"] as const;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ tag: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { tag } = await ctx.params;
  const params = request.nextUrl.searchParams;

  const bucketRaw = params.get("bucket");
  const statusRaw = params.get("status");
  const limitRaw = Number(params.get("limit"));

  const bucket = BUCKETS.find((b) => b === bucketRaw);
  const status = STATUSES.find((s) => s === statusRaw);

  const result = await createContainer().listGapKeywords.execute({
    tag,
    bucket,
    status,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  });

  return Response.json({ tag, ...result });
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ tag: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { tag } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json(
      {
        error: "Invalid request.",
        fields: [{ field: "body", message: "Expected a JSON object." }],
      },
      { status: 400 },
    );
  }

  const status = STATUSES.find((s) => s === body.status);
  if (!status) {
    return Response.json(
      {
        error: "Invalid request.",
        fields: [
          {
            field: "status",
            message: `Must be one of: ${STATUSES.join(", ")}.`,
          },
        ],
      },
      { status: 400 },
    );
  }

  const keywords = stringArray(body.keywords);
  if (keywords === null || keywords.length === 0) {
    return Response.json(
      {
        error: "Invalid request.",
        fields: [
          {
            field: "keywords",
            message: "Required. A non-empty array of keywords.",
          },
        ],
      },
      { status: 400 },
    );
  }

  const result = await createContainer().setGapStatus.execute({
    tag,
    keywords,
    status,
  });

  return Response.json({ tag, status, ...result });
}

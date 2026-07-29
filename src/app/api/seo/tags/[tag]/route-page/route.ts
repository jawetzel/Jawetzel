import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { isRecord } from "@/application/use-cases/seo/request-fields";
import { type RouteVerdict } from "@/domain/seo/routing";

/**
 * `/api/seo/tags/[tag]/route-page` — layer 4a, the router.
 *
 * POST  `{ url }` — sort the accepted pile against that one page's content into
 *       improve / enrich / create.
 * PATCH `{ url, keyword, verdict }` — correct one verdict. The correction is
 *       marked `overridden` and survives every later re-route.
 *
 * The model classifies here and nowhere else in the pipeline; it never produces
 * a number. `improve` isn't asked at all — the vendor already told us which of
 * our URLs holds the ranking.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One crawl plus a model call per 40 keywords. */
export const maxDuration = 300;

const VERDICTS: RouteVerdict[] = ["improve", "enrich", "create"];

export async function POST(
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

  const url = isRecord(body) && typeof body.url === "string" ? body.url.trim() : "";
  if (url === "") {
    return Response.json(
      {
        error: "Invalid request.",
        fields: [{ field: "url", message: "Required. The page to route against." }],
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await createContainer().routePageKeywords.execute({
      tag,
      pageUrl: url,
    });

    if (!isOk(result)) {
      switch (result.error) {
        case "TAG_NOT_FOUND":
          return Response.json(
            { error: "No such customer tag.", code: result.error },
            { status: 404 },
          );
        case "NOTHING_ACCEPTED":
          return Response.json(
            {
              error: "Accept some keywords in the gap pile before routing them.",
              code: result.error,
            },
            { status: 409 },
          );
        case "PAGE_UNREACHABLE":
          return Response.json(
            {
              error:
                "Could not fetch that page. It must be publicly reachable and return HTML.",
              code: result.error,
            },
            { status: 422 },
          );
        case "ROUTING_FAILED":
          return Response.json(
            {
              error:
                "The classifier returned nothing usable, so no verdict here is trustworthy.",
              code: result.error,
            },
            { status: 502 },
          );
      }
    }

    return Response.json({
      ...result.value,
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    // Log once, at the boundary — never per layer.
    console.error("[seo/route-page] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
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

  const fields: Array<{ field: string; message: string }> = [];
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (url === "") fields.push({ field: "url", message: "Required." });
  const keyword =
    typeof body.keyword === "string" ? body.keyword.trim().toLowerCase() : "";
  if (keyword === "") fields.push({ field: "keyword", message: "Required." });
  const verdict = VERDICTS.find((v) => v === body.verdict);
  if (!verdict) {
    fields.push({
      field: "verdict",
      message: `Must be one of: ${VERDICTS.join(", ")}.`,
    });
  }
  if (fields.length > 0) {
    return Response.json({ error: "Invalid request.", fields }, { status: 400 });
  }

  const changed = await createContainer().overrideRouting.execute({
    tag,
    pageUrl: url,
    keyword,
    verdict: verdict as RouteVerdict,
  });

  if (!changed) {
    return Response.json(
      { error: "No routing for that page and keyword.", code: "ROUTING_NOT_FOUND" },
      { status: 404 },
    );
  }

  return Response.json({ tag, pageUrl: url, keyword, verdict, overridden: true });
}

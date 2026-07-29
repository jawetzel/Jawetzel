import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";

/**
 * `POST /api/seo/runs/[runId]/gaps` — layer 2.
 *
 * Pulls `domain_intersection` for every approved competitor plus our own
 * `ranked_keywords`, and merges the result into the tag's gap pile. The run
 * moves to `gaps_ready`; the pile itself is reviewed on the tag, not the run,
 * because rejecting a keyword is a decision about the keyword.
 *
 * This is the expensive layer — one call per approved competitor — which is
 * why the layer-1 gate exists.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Up to a dozen live vendor calls in parallel, each allowed 60s by the shared
 * client. 300 leaves room for a slow tail without holding a socket forever.
 */
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { runId } = await ctx.params;
  const startedAt = Date.now();

  try {
    const result = await createContainer().buildGapPile.execute({ runId });

    if (!isOk(result)) {
      switch (result.error) {
        case "RUN_NOT_FOUND":
          return Response.json(
            { error: "No such run.", code: result.error },
            { status: 404 },
          );
        case "TAG_NOT_FOUND":
          return Response.json(
            { error: "This run's tag no longer exists.", code: result.error },
            { status: 404 },
          );
        case "COMPETITORS_NOT_APPROVED":
          return Response.json(
            {
              error: "Approve the competitor set before running layer 2.",
              code: result.error,
            },
            { status: 409 },
          );
        case "NO_COMPETITORS_APPROVED":
          return Response.json(
            {
              error:
                "Every competitor was rejected, so there is nothing to compare against.",
              code: result.error,
            },
            { status: 409 },
          );
        case "GAP_NOT_CONFIGURED":
          return Response.json(
            {
              error: "SERP provider is not configured on this server.",
              code: result.error,
            },
            { status: 503 },
          );
        case "NO_GAP_DATA":
          return Response.json(
            {
              error:
                "No gap keywords and no rankings of our own came back for this property.",
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
    console.error("[seo/runs/gaps] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

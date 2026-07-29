import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { isRecord } from "@/application/use-cases/seo/request-fields";

/**
 * `POST /api/seo/tags/[tag]/screen` — layer 3.
 *
 * Observes the SERP for every **accepted** keyword and scores how soft the page
 * currently there is. Difficulty says how hard it would be to rank; this says
 * how weak the incumbents are, which is the more actionable of the two and is
 * not expressible as a single vendor number.
 *
 * Cheap by design (~$0.002 a keyword, corpus-first) so a reviewer can screen
 * dozens. The expensive per-page work is layer 4's.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Up to 40 SERPs at concurrency 5. 300 leaves room for a slow tail. */
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ tag: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { tag } = await ctx.params;

  // A bare POST is the common case; a body only appears when overriding.
  const body: unknown = await request.json().catch(() => ({}));
  const options = isRecord(body) ? body : {};

  const startedAt = Date.now();
  try {
    const result = await createContainer().screenFinalists.execute({
      tag,
      limit: typeof options.limit === "number" ? options.limit : undefined,
      maxSnapshotAgeDays:
        typeof options.maxSnapshotAgeDays === "number"
          ? options.maxSnapshotAgeDays
          : undefined,
      rescreen: options.rescreen === true,
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
              error:
                "Accept some keywords in the gap pile before screening them.",
              code: result.error,
            },
            { status: 409 },
          );
        case "SERP_NOT_CONFIGURED":
          return Response.json(
            {
              error: "SERP provider is not configured on this server.",
              code: result.error,
            },
            { status: 503 },
          );
      }
    }

    return Response.json({
      tag,
      ...result.value,
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    // Log once, at the boundary — never per layer.
    console.error("[seo/screen] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

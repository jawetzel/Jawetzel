import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { isRecord } from "@/application/use-cases/seo/request-fields";

/**
 * `POST /api/seo/work-order` — layer 4b.
 *
 * `{ analysisId, refresh? }` → the swaps of a stored run, written out as a work
 * order a page owner can act on.
 *
 * **No vendor cost.** It reads a run that was already paid for; re-rendering is
 * tokens only. Deliberately separate from `analyze` rather than an `include`
 * option: folding it in would make a deterministic endpoint non-deterministic
 * and add a model round trip to a call that already runs 10–40s.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const analysisId =
    isRecord(body) && typeof body.analysisId === "string"
      ? body.analysisId.trim()
      : "";
  if (analysisId === "") {
    return Response.json(
      {
        error: "Invalid request.",
        fields: [
          { field: "analysisId", message: "Required. The stored run to render." },
        ],
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await createContainer().renderWorkOrder.execute({
      analysisId,
      refresh: isRecord(body) && body.refresh === true,
    });

    if (!isOk(result)) {
      switch (result.error) {
        case "ANALYSIS_NOT_FOUND":
          return Response.json(
            { error: "No such analysis.", code: result.error },
            { status: 404 },
          );
        case "NOTHING_TO_DO":
          // A page already matching everything measured has no work order.
          // Saying so beats prose padded out to look useful.
          return Response.json(
            {
              error:
                "This page already matches what was measured — nothing worth changing.",
              code: result.error,
            },
            { status: 409 },
          );
        case "RENDER_FAILED":
          return Response.json(
            {
              error: "The renderer returned nothing usable.",
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
    console.error("[seo/work-order] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

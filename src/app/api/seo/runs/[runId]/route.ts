import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { parseApproveCompetitorsRequest } from "@/application/use-cases/seo/parse-approve-competitors-request";

/**
 * `/api/seo/runs/[runId]` — read a run, or pass its layer-1 gate.
 *
 * GET   — resume. A funnel run costs a few dollars and spans several minutes
 *         across gates, so its state lives here rather than in a browser tab.
 * PATCH — approve the competitor set. Layer 2 runs per competitor and is the
 *         expensive layer, so nothing is spent until a human has said which of
 *         the observed domains are real. An empty `domains` array is a valid
 *         answer and is honoured literally.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { runId } = await ctx.params;
  const run = await createContainer().getIntelRun.execute({ runId });
  if (!run) {
    return Response.json(
      { error: "No such run.", code: "RUN_NOT_FOUND" },
      { status: 404 },
    );
  }

  return Response.json({ run });
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { runId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseApproveCompetitorsRequest(body);
  if (!isOk(parsed)) {
    return Response.json(
      { error: "Invalid request.", fields: parsed.error },
      { status: 400 },
    );
  }

  const result = await createContainer().approveCompetitors.execute({
    runId,
    domains: parsed.value.domains,
  });

  if (!isOk(result)) {
    switch (result.error) {
      case "RUN_NOT_FOUND":
        return Response.json(
          { error: "No such run.", code: result.error },
          { status: 404 },
        );
      case "COMPETITORS_NOT_READY":
        return Response.json(
          {
            error: "Layer 1 has not returned for this run yet.",
            code: result.error,
          },
          { status: 409 },
        );
    }
  }

  return Response.json({ run: result.value });
}

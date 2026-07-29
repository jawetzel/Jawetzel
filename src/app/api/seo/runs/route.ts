import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { parseStartIntelRunRequest } from "@/application/use-cases/seo/parse-start-intel-run-request";

/**
 * `/api/seo/runs` — layer 1 of the funnel.
 *
 * GET  `?tag=` — that tag's lookup history, newest first.
 * POST         — a keyword list in, the competitor set out. Creating the run
 *                and running layer 1 are one call because there is no gate
 *                *before* layer 1; the first gate is the PATCH on
 *                `/api/seo/runs/[runId]` that approves the returned domains.
 *
 * → `src/app/api/seo/API.md` for the contract.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * One `serp_competitors` call against up to 200 keywords. Well inside a minute
 * in practice; 120 leaves room for a slow vendor without holding a socket open
 * indefinitely — same ceiling as `analyze`.
 */
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const tag = request.nextUrl.searchParams.get("tag")?.trim() ?? "";
  if (tag === "") {
    return Response.json(
      { error: "Invalid request.", fields: [{ field: "tag", message: "Required." }] },
      { status: 400 },
    );
  }

  const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
  const runs = await createContainer().listIntelRuns.execute({
    tag,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  });
  return Response.json({ tag, runs });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseStartIntelRunRequest(body);
  if (!isOk(parsed)) {
    return Response.json(
      { error: "Invalid request.", fields: parsed.error },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await createContainer().startIntelRun.execute(parsed.value);

    if (!isOk(result)) {
      switch (result.error) {
        case "TAG_NOT_FOUND":
          return Response.json(
            { error: "No such customer tag.", code: result.error },
            { status: 404 },
          );
        case "NO_KEYWORDS":
          return Response.json(
            {
              error: "No usable keywords after normalization.",
              code: result.error,
            },
            { status: 400 },
          );
        case "COMPETITORS_NOT_CONFIGURED":
          // Fail closed, like `analyze`: a competitor set we cannot observe is
          // not a competitor set, and guessing one would poison every later
          // layer that spends money against it.
          return Response.json(
            {
              error: "SERP provider is not configured on this server.",
              code: result.error,
            },
            { status: 503 },
          );
        case "COMPETITORS_UNAVAILABLE":
          return Response.json(
            {
              error:
                "SERP provider returned no usable competitors for these keywords.",
              code: result.error,
            },
            { status: 502 },
          );
      }
    }

    return Response.json(
      { ...result.value, durationMs: Date.now() - startedAt },
      { status: 201 },
    );
  } catch (cause) {
    // Log once, at the boundary — never per layer.
    console.error("[seo/runs] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

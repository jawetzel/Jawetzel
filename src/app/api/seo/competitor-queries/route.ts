import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { parseDiscoverCompetitorQueriesRequest } from "@/application/use-cases/seo/parse-discover-competitor-queries-request";

/**
 * `POST /api/seo/competitor-queries` — the Discover loop's driving adapter.
 *
 * Given a page and the query it was just analyzed for, returns the on-topic
 * queries the SERP's competitors already win, ranked as next `analyze` targets.
 *
 * Thin by mandate: authenticate, parse, call the use-case, map the Result to a
 * status code. Auth is the shared `requireAuth` shim on the same per-surface
 * `SEO_API_KEY` as the other SEO endpoints.
 *
 * → `src/app/api/seo/API.md` for the request/response contract.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * One request is one page fetch, possibly one live SERP, and up to six
 * ranked-keywords pulls in parallel. The realistic ceiling is well under a
 * minute; 120 leaves room for a slow vendor without holding a socket forever.
 */
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = parseDiscoverCompetitorQueriesRequest(body);
  if (!isOk(parsed)) {
    // Every failure names its field — a caller never gets a generic rejection.
    return Response.json(
      { error: "Invalid request.", fields: parsed.error },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result =
      await createContainer().discoverCompetitorQueries.execute(parsed.value);

    if (!isOk(result)) {
      switch (result.error) {
        case "PAGE_UNREACHABLE":
          return Response.json(
            {
              error:
                "Could not fetch the URL. It must be publicly reachable and return HTML.",
              code: result.error,
            },
            { status: 422 },
          );
        case "SERP_NOT_CONFIGURED":
        case "RANKED_KEYWORDS_NOT_CONFIGURED":
          // Fail closed and say so plainly: without provider data there is no
          // competition to observe, and a guessed list would look like an answer.
          return Response.json(
            {
              error: "SERP provider is not configured on this server.",
              code: result.error,
            },
            { status: 503 },
          );
        case "SERP_UNAVAILABLE":
          return Response.json(
            {
              error: "SERP provider returned no usable result for this query.",
              code: result.error,
            },
            { status: 502 },
          );
        case "NO_COMPETITOR_DATA":
          return Response.json(
            {
              error:
                "No competitor ranking data came back — every domain pull failed or the SERP held nobody but you.",
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
    console.error("[seo/competitor-queries] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

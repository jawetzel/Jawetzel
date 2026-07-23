import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { parseSuggestQueriesRequest } from "@/application/use-cases/seo/parse-suggest-queries-request";

/**
 * `POST /api/seo/suggest-queries` — the "what should my target query be?" helper.
 *
 * Crawl the page, let the LLM draft candidate queries, price them with real
 * DataForSEO demand data, and return a ranked shortlist. Thin by mandate:
 * authenticate, parse, call the use-case, map the Result to a status code.
 *
 * Same three-principal auth as the analyze surface (session cookie, per-user
 * `pwsk_` key, or the shared `SEO_API_KEY`). This is an *input helper* — the
 * deterministic analyzer stays LLM-free; nothing here writes to the corpus.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One crawl + one LLM call + one keyword batch. Realistic ceiling ~30s. */
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseSuggestQueriesRequest(body);
  if (!isOk(parsed)) {
    return Response.json(
      { error: "Invalid request.", fields: parsed.error },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await createContainer().suggestQueries.execute(parsed.value);

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
        case "NO_SUGGESTIONS":
          return Response.json(
            {
              error:
                "Could not draft any query suggestions for this page. Try a more content-rich URL.",
              code: result.error,
            },
            { status: 422 },
          );
      }
    }

    return Response.json({
      ...result.value,
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    console.error("[seo/suggest-queries] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

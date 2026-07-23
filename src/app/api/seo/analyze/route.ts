import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { parseAnalyzePageRequest } from "@/application/use-cases/seo/parse-analyze-page-request";

/**
 * `POST /api/seo/analyze` — the advisory engine's driving adapter.
 *
 * Thin by mandate: authenticate, parse, call the use-case, map the Result to a
 * status code. No business logic, no measurement, no vendor field names.
 *
 * Auth is the shared `requireAuth` shim, so this surface accepts all three
 * principals: an admin session cookie, a per-user `pwsk_` key, or the shared
 * `SEO_API_KEY`. Per-surface env keys keep blast radius small — a leaked SEO key
 * unlocks this endpoint and nothing else.
 *
 * → `src/app/api/seo/API.md` for the request/response contract.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * One request fans out to a live SERP call plus up to eleven page fetches at a
 * concurrency of five, each with a 12s timeout. The realistic ceiling is ~45s;
 * 120 leaves room for a slow vendor without holding a socket forever.
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

  const parsed = parseAnalyzePageRequest(body);
  if (!isOk(parsed)) {
    // Every failure names its field — a caller never gets a generic rejection.
    return Response.json(
      { error: "Invalid request.", fields: parsed.error },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await createContainer().analyzePage.execute(parsed.value);

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
          // Fail closed and say so plainly: without SERP data every delta fact
          // is unknowable, and a sheet built from page facts alone would look
          // like an answer while being a guess.
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
      }
    }

    return Response.json({
      ...result.value,
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    // Log once, at the boundary — never per layer.
    console.error("[seo/analyze] failed:", cause);
    return Response.json(
      {
        error: cause instanceof Error ? cause.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

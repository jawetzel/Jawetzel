import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";
import { isOk } from "@/domain/shared/result";
import { parseCreateSeoTagRequest } from "@/application/use-cases/seo/parse-create-seo-tag-request";

/**
 * `/api/seo/tags` — customer tags, the workspace's identity.
 *
 * GET  — every tag, for the picker.
 * POST — create or update one. Re-posting an existing slug updates its config
 *        in place; `entitySchema` is the field most likely to be refined after
 *        seeing real output, and a delete/recreate would orphan run history.
 *
 * Thin by mandate: authenticate, parse, call the use-case, map the Result.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const tags = await createContainer().listSeoTags.execute();
  return Response.json({ tags });
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

  const parsed = parseCreateSeoTagRequest(body);
  if (!isOk(parsed)) {
    return Response.json(
      { error: "Invalid request.", fields: parsed.error },
      { status: 400 },
    );
  }

  const result = await createContainer().createSeoTag.execute(parsed.value);
  if (!isOk(result)) {
    switch (result.error) {
      case "INVALID_TAG":
        return Response.json(
          {
            error: "Tag must be 2–64 lowercase alphanumerics separated by hyphens.",
            code: result.error,
          },
          { status: 400 },
        );
      case "INVALID_DOMAIN":
        return Response.json(
          {
            error: "Domain must be a hostname, e.g. example.com.",
            code: result.error,
          },
          { status: 400 },
        );
    }
  }

  return Response.json({ tag: result.value }, { status: 201 });
}

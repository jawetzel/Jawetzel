import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createContainer } from "@/composition/container";

/**
 * `GET /api/seo/tags/[tag]/backlog` — accepted keywords no page run has claimed.
 *
 * The long-game output: one page declining a keyword says almost nothing, but
 * after twenty pages the residue is the property's real coverage gap — found
 * without ever crawling the site.
 *
 * `coverage.pagesRouted` ships with every response and is not optional. After
 * three pages this list is mostly "we haven't looked yet", and presenting it as
 * a finding would be the same dishonesty as inventing a number for something we
 * never measured.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ tag: string }> },
) {
  const auth = await requireAuth(request, "SEO_API_KEY");
  if (auth instanceof Response) return auth;

  const { tag } = await ctx.params;
  const result = await createContainer().listBacklog.execute({ tag });
  return Response.json({ tag, ...result });
}

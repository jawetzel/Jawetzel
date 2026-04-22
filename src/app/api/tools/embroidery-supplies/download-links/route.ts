/**
 * Issue time-limited presigned download URLs for the compiled supplies feeds.
 *
 *   POST /api/tools/embroidery-supplies/download-links
 *
 * Any authenticated principal (session cookie, per-user API key, or the
 * shared EMBROIDERY_API_KEY) can request this. The R2 bucket itself can be
 * kept private — these URLs are signed with our server credentials and are
 * only valid for TTL_SECONDS seconds.
 *
 * Pattern mirrors taxation_is_theft's `/document/{id}/download` endpoint:
 *   - session gate at the edge (requireAuth)
 *   - per-request URL generation (no caching of the URLs themselves)
 *   - short TTL (15 min) — matches their default
 *   - audit log line per issuance so we can trace abuse
 *
 * Response:
 * ```
 *   {
 *     "expires_at": "2026-04-22T20:15:00Z",
 *     "ttl_seconds": 900,
 *     "links": [
 *       { "name": "details",      "filename": "supplies-details-2026-04-22.json", "url": "...", "content_type": "application/json" },
 *       { "name": "pricing-json", "filename": "supplies-pricing-2026-04-22.json", "url": "...", "content_type": "application/json" },
 *       { "name": "pricing-csv",  "filename": "supplies-pricing-2026-04-22.csv",  "url": "...", "content_type": "text/csv"          }
 *     ]
 *   }
 * ```
 */

import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { generatePresignedDownloadUrl } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_SECONDS = 15 * 60;

type LinkSpec = {
  name: string;
  key: string;
  filenameBase: string;
  extension: "json" | "csv";
  contentType: string;
};

const LINKS: LinkSpec[] = [
  {
    name: "details",
    key: "supplies/details/current.json",
    filenameBase: "supplies-details",
    extension: "json",
    contentType: "application/json",
  },
  {
    name: "pricing-json",
    key: "supplies/pricing/current.json",
    filenameBase: "supplies-pricing",
    extension: "json",
    contentType: "application/json",
  },
  {
    name: "pricing-csv",
    key: "supplies/pricing/current.csv",
    filenameBase: "supplies-pricing",
    extension: "csv",
    contentType: "text/csv",
  },
];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "EMBROIDERY_API_KEY");
  if (auth instanceof Response) return auth;

  const day = todayKey();
  const results = await Promise.all(
    LINKS.map(async (spec) => {
      const filename = `${spec.filenameBase}-${day}.${spec.extension}`;
      const { url, expiresAt } = await generatePresignedDownloadUrl(
        spec.key,
        TTL_SECONDS,
        filename,
      );
      return {
        name: spec.name,
        filename,
        url,
        content_type: spec.contentType,
        expires_at: expiresAt.toISOString(),
      };
    }),
  );

  // Audit log — one line per issuance, covers user identity + all issued keys.
  console.log(
    `[supplies download-links] issued by user=${auth.userId ?? "service"} role=${auth.role} keys=${LINKS.map((l) => l.key).join(",")} ttl=${TTL_SECONDS}s`,
  );

  return Response.json({
    expires_at: results[0]?.expires_at,
    ttl_seconds: TTL_SECONDS,
    links: results,
  });
}

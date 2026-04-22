import type { NextRequest } from "next/server";
import spec from "./spec.json";

export const runtime = "nodejs";

// Serve the OpenAPI spec with the `servers[0].url` rewritten at request time
// so the same JSON works in any environment (local, preview, prod). Falls
// back to the request's own origin if APP_URL isn't set.
export function GET(request: NextRequest) {
  const url = process.env.APP_URL ?? new URL(request.url).origin;
  const body = {
    ...spec,
    servers: [{ url, description: "Current environment" }],
  };
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

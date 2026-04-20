import { NextRequest } from "next/server";

import { requireAuth } from "../../_lib/auth";

export const runtime = "nodejs";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8080";

export async function POST(request: NextRequest) {
  const unauth = requireAuth(request);
  if (unauth) return unauth;

  const body = await request.arrayBuffer();
  const contentType =
    request.headers.get("content-type") ?? "application/octet-stream";

  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${WORKER_URL}/convert`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
  } catch {
    return Response.json(
      { error: "Worker unreachable" },
      { status: 502 },
    );
  }

  // Translate uvicorn's --limit-concurrency 503 into a proper 429 rate-limit
  // response with a JSON body and Retry-After hint, matching /generate's shape.
  if (workerResponse.status === 503) {
    return Response.json(
      { error: "All worker slots busy. Retry after the Retry-After seconds." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  return new Response(workerResponse.body, {
    status: workerResponse.status,
    headers: {
      "content-type":
        workerResponse.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}

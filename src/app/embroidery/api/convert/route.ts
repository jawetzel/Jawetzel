import { NextRequest } from "next/server";

import { requireAuth } from "../../_lib/auth";
import { ALLOWED_SIZES, validateSize } from "../../_lib/pipeline";

export const runtime = "nodejs";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8080";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const sizeRaw = request.nextUrl.searchParams.get("size");
  if (!sizeRaw) {
    return Response.json(
      { error: "Missing required query param: size" },
      { status: 400 },
    );
  }
  let size: string;
  try {
    size = validateSize(sizeRaw);
  } catch {
    return Response.json(
      {
        error: `Invalid size "${sizeRaw}". Allowed: ${ALLOWED_SIZES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const body = await request.arrayBuffer();
  const contentType =
    request.headers.get("content-type") ?? "application/octet-stream";

  const workerQs = new URLSearchParams({ size }).toString();
  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${WORKER_URL}/convert?${workerQs}`, {
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

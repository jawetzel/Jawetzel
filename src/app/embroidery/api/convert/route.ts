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

  return new Response(workerResponse.body, {
    status: workerResponse.status,
    headers: {
      "content-type":
        workerResponse.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}

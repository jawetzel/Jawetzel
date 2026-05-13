import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8080";
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

function workerPost(body: Uint8Array, contentType: string): Promise<{ status: number; body: Uint8Array }> {
  const url = new URL("/trace-color", WORKER_URL);
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: "POST",
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          "content-type": contentType,
          "content-length": body.byteLength.toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: new Uint8Array(Buffer.concat(chunks)),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(WORKER_TIMEOUT_MS, () => {
      req.destroy(new Error(`Worker /trace-color timed out after ${WORKER_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data body with an `image` file." },
      { status: 400 },
    );
  }

  const image = form.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return Response.json(
      { error: "Missing required file: image" },
      { status: 400 },
    );
  }
  if (image.size > MAX_BYTES) {
    return Response.json(
      { error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  if (image.type && !ALLOWED_TYPES.has(image.type)) {
    return Response.json(
      {
        error: `Unsupported image type ${image.type}. Allowed: ${[...ALLOWED_TYPES].join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const contentType = image.type || "application/octet-stream";

  let result: { status: number; body: Uint8Array };
  try {
    result = await workerPost(imageBytes, contentType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }

  if (result.status === 503) {
    return Response.json(
      { error: "Worker busy. Try again in a few seconds." },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }
  if (result.status < 200 || result.status >= 300) {
    const text = new TextDecoder().decode(result.body).slice(0, 500);
    return Response.json(
      { error: `Worker returned ${result.status}: ${text}` },
      { status: 502 },
    );
  }

  const sourceName = image instanceof File && image.name ? image.name : "image";
  const downloadName = sourceName.replace(/\.[a-zA-Z0-9]+$/, "") + ".svg";

  // Copy into a fresh ArrayBuffer so TS doesn't widen to ArrayBufferLike
  // (which Response/Blob refuse).
  const out = new Uint8Array(result.body.byteLength);
  out.set(result.body);
  return new Response(out.buffer, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "content-length": out.byteLength.toString(),
      "content-disposition": `attachment; filename="${downloadName}"`,
    },
  });
}

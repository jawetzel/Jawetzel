import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8080";
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;

export class WorkerError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly body: string,
  ) {
    super(`Worker ${endpoint} failed: ${status} ${body}`);
    this.name = "WorkerError";
  }
}

// Ink/Stitch can run for ~5-10 min, which exceeds undici fetch's default
// 5-min headers timeout. Use node:http directly so we control socket timeouts.
function workerPost(
  endpoint: string,
  body: Uint8Array,
  contentType: string,
): Promise<Uint8Array> {
  const url = new URL(endpoint, WORKER_URL);
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
          const buf = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const text = buf.toString("utf8").slice(0, 500);
            reject(new WorkerError(status, endpoint, text));
            return;
          }
          resolve(new Uint8Array(buf));
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(WORKER_TIMEOUT_MS, () => {
      req.destroy(new Error(`Worker ${endpoint} timed out after ${WORKER_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export function traceImage(
  pngBytes: Uint8Array,
  size: string,
  colors: number,
  palette?: string[],
  extractOutline: boolean = true,
): Promise<Uint8Array> {
  const params: Record<string, string> = { size, colors: String(colors) };
  if (palette && palette.length > 0) {
    // Comma-separated hex strings without the '#' so the querystring is clean.
    params.palette = palette.map((c) => c.replace(/^#/, "")).join(",");
  }
  params.extract_outline = extractOutline ? "1" : "0";
  const qs = new URLSearchParams(params).toString();
  return workerPost(`/trace?${qs}`, pngBytes, "image/png");
}

export function convertSvg(svgBytes: Uint8Array): Promise<Uint8Array> {
  return workerPost("/convert", svgBytes, "image/svg+xml");
}

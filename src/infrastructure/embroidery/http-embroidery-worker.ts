import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

import {
  type ClusterRouting,
  type EmbroideryComputeGateway,
  type SampledColors,
  WorkerError,
} from "@/application/ports/embroidery-compute-gateway";

/**
 * HttpEmbroideryWorker — the production {@link EmbroideryComputeGateway},
 * backed by the separate Python embroidery-compute microservice. After the
 * embroidery-gateway slice this is the **only** module in the app that knows the
 * Python service URL (`WORKER_URL`) and speaks `node:http` to it.
 *
 * The HTTP machinery moved here **verbatim** from the old
 * `src/app/embroidery/_lib/worker.ts`: the `WORKER_URL` default, the 15-minute
 * socket timeout, the protocol/port selection, the header names, the 500-char
 * error-body slice, and the timeout-destroy message. `src/app/embroidery/_lib/
 * worker.ts` is now a thin shim delegating to a singleton of this class via the
 * DB-free `composition/embroidery-compute.ts`.
 *
 * **Why `node:http`, not `fetch`:** Ink/Stitch can run for ~5–10 min, which
 * exceeds undici fetch's default 5-min headers timeout. Using `node:http`
 * directly lets us set our own socket timeout (`WORKER_TIMEOUT_MS`). Do **not**
 * switch this to `fetch` — it would reintroduce that timeout bug.
 *
 * See `docs/architecture/worker.md` → the Python compute microservice.
 */

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8080";
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;

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

/**
 * Build the `/trace` querystring from the trace parameters. Extracted as a pure
 * function (no I/O) so the param names, the palette `#`-stripping + comma-join,
 * the `extract_outline` `"1"`/`"0"` flag, the routing clusters===routes guard,
 * and the skip-index encoding are unit-testable without a live worker. Mirrors
 * how `R2ObjectStore` extracted `buildPublicUrl`.
 */
export function buildTraceQuery(
  size: string,
  colors: number,
  palette?: string[],
  extractOutline: boolean = true,
  routing?: ClusterRouting,
  skipIndices?: number[],
): string {
  const params: Record<string, string> = { size, colors: String(colors) };
  if (palette && palette.length > 0) {
    // Comma-separated hex strings without the '#' so the querystring is clean.
    params.palette = palette.map((c) => c.replace(/^#/, "")).join(",");
  }
  params.extract_outline = extractOutline ? "1" : "0";
  if (routing && routing.clusters.length > 0 && routing.clusters.length === routing.routes.length) {
    params.clusters = routing.clusters.map((c) => c.replace(/^#/, "")).join(",");
    params.routes = routing.routes.join(",");
  }
  if (skipIndices && skipIndices.length > 0) {
    // Palette indices the worker should treat as unstitched fabric (AI
    // marked them as background role — no thread, no trace).
    params.skip = skipIndices.join(",");
  }
  return new URLSearchParams(params).toString();
}

/**
 * Build the `/sample-colors` querystring. Extracted as a pure function so the
 * `n` stringification, the `full_res` flag, and the optional `size` hint are
 * unit-testable without a live worker.
 */
export function buildSampleColorsQuery(
  n: number = 20,
  fullRes: boolean = false,
  size?: string,
): string {
  const params: Record<string, string> = { n: String(n) };
  if (fullRes) params.full_res = "1";
  // Passing size lets the worker resize the source to match /trace's actual
  // quantize input — apples-to-apples cluster set AND it bounds the worker's
  // memory ceiling so huge source PNGs don't OOM-kill the container during
  // halo detection.
  if (size) params.size = size;
  return new URLSearchParams(params).toString();
}

export class HttpEmbroideryWorker implements EmbroideryComputeGateway {
  trace(
    pngBytes: Uint8Array,
    size: string,
    colors: number,
    palette?: string[],
    extractOutline: boolean = true,
    routing?: ClusterRouting,
    skipIndices?: number[],
  ): Promise<Uint8Array> {
    const qs = buildTraceQuery(
      size,
      colors,
      palette,
      extractOutline,
      routing,
      skipIndices,
    );
    return workerPost(`/trace?${qs}`, pngBytes, "image/png");
  }

  convert(svgBytes: Uint8Array, size: string): Promise<Uint8Array> {
    const qs = new URLSearchParams({ size }).toString();
    return workerPost(`/convert?${qs}`, svgBytes, "image/svg+xml");
  }

  // Ask the worker to extract dominant subject colors so the AI palette step
  // picks threads that match measured pixel clusters instead of guessing
  // semantic colors. Used to prevent palette overlap in RGB space.
  // fullRes=true skips the 200×200 downsample so the cluster set matches what
  // the trace stage will actually quantize against (apples-to-apples routing).
  async sampleColors(
    pngBytes: Uint8Array,
    n: number = 20,
    fullRes: boolean = false,
    size?: string,
  ): Promise<SampledColors> {
    const qs = buildSampleColorsQuery(n, fullRes, size);
    const bytes = await workerPost(`/sample-colors?${qs}`, pngBytes, "image/png");
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as SampledColors;
    return parsed;
  }
}

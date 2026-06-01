import { getEmbroideryComputeGateway } from "@/composition/embroidery-compute";
import {
  type ClusterRouting,
  type SampledColor,
  type SampledColors,
  WorkerError,
} from "@/application/ports/embroidery-compute-gateway";

/**
 * Thin shim over the {@link EmbroideryComputeGateway} port.
 *
 * The `node:http` machinery (the `WORKER_URL` default, the 15-min socket
 * timeout, the protocol/port selection, the 500-char error-body slice) moved
 * verbatim into `infrastructure/embroidery/HttpEmbroideryWorker` (now the sole
 * module that knows the Python service URL / speaks `node:http` to it). These
 * three functions keep their exact historical signatures + defaults and
 * delegate to the singleton wired in the DB-free
 * `composition/embroidery-compute.ts`, so the consumers stay byte-for-byte
 * unchanged: `pipeline.ts` imports `traceImage`/`convertSvg`/`sampleColors`,
 * the two generate routes import `WorkerError` (and catch it via `instanceof`),
 * and `ai/select-palette.ts` imports the `SampledColors` *type*.
 *
 * `WorkerError` and the contract types are **re-exported** from the port — they
 * are defined there once (never redefined), so the routes' `instanceof
 * WorkerError` class-identity check keeps working through this shim.
 */

export {
  WorkerError,
  type ClusterRouting,
  type SampledColor,
  type SampledColors,
};

export function traceImage(
  pngBytes: Uint8Array,
  size: string,
  colors: number,
  palette?: string[],
  extractOutline: boolean = true,
  routing?: ClusterRouting,
  skipIndices?: number[],
): Promise<Uint8Array> {
  return getEmbroideryComputeGateway().trace(
    pngBytes,
    size,
    colors,
    palette,
    extractOutline,
    routing,
    skipIndices,
  );
}

export function convertSvg(
  svgBytes: Uint8Array,
  size: string,
): Promise<Uint8Array> {
  return getEmbroideryComputeGateway().convert(svgBytes, size);
}

export function sampleColors(
  pngBytes: Uint8Array,
  n: number = 20,
  fullRes: boolean = false,
  size?: string,
): Promise<SampledColors> {
  return getEmbroideryComputeGateway().sampleColors(pngBytes, n, fullRes, size);
}

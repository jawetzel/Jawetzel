/**
 * EmbroideryComputeGateway — a driven port for the separate Python
 * embroidery-compute microservice (the Ink/Stitch trace / SVG-convert /
 * color-sample HTTP API).
 *
 * Consumer-owned: the embroidery pipeline (and the AI palette step, for its
 * `SampledColors` type) say "trace these PNG bytes into stitches" / "convert
 * this SVG" / "sample these colors," never "POST to the Python service." Named
 * for the capability, not the technology. The production adapter is
 * `infrastructure/embroidery/HttpEmbroideryWorker` (which speaks `node:http`
 * directly — see the note in `convert` below); a fake can stand in for tests.
 *
 * The three methods mirror the historical `traceImage` / `convertSvg` /
 * `sampleColors` functions byte-for-byte — same parameters, same defaults — so
 * the still-flat `src/app/embroidery/_lib/worker.ts` is now just a shim that
 * delegates here.
 *
 * See `docs/architecture/worker.md` → the Python compute microservice, and
 * `docs/architecture/embroidery.md`.
 */
export interface EmbroideryComputeGateway {
  /**
   * Trace a quantized PNG into machine-ready stitch artifacts. Returns the
   * worker's response bytes (a ZIP the pipeline unpacks).
   *
   * @param pngBytes      the source PNG
   * @param size          target physical size string the worker resizes to
   * @param colors        number of palette colors to quantize to
   * @param palette       optional thread hexes; the worker quantizes against
   *                      them. Encoded `#`-stripped, comma-joined.
   * @param extractOutline whether to emit the subject outline (default true)
   * @param routing       optional parallel clusters→palette routing (only sent
   *                      when both arrays are non-empty AND equal-length)
   * @param skipIndices   optional palette indices the worker treats as
   *                      unstitched fabric (AI background role)
   */
  trace(
    pngBytes: Uint8Array,
    size: string,
    colors: number,
    palette?: string[],
    extractOutline?: boolean,
    routing?: ClusterRouting,
    skipIndices?: number[],
  ): Promise<Uint8Array>;

  /** Convert an SVG into the worker's stitch artifact bytes. */
  convert(svgBytes: Uint8Array, size: string): Promise<Uint8Array>;

  /**
   * Ask the worker to extract dominant subject colors so the AI palette step
   * matches measured pixel clusters instead of guessing semantic colors.
   *
   * @param n        number of clusters to return (default 20)
   * @param fullRes  skip the 200×200 downsample so the cluster set matches the
   *                 trace stage's quantize input (default false)
   * @param size     optional resize hint; bounds the worker's memory ceiling
   */
  sampleColors(
    pngBytes: Uint8Array,
    n?: number,
    fullRes?: boolean,
    size?: string,
  ): Promise<SampledColors>;
}

/**
 * Thrown by the gateway when the Python worker returns a non-2xx status. Its
 * **class identity is load-bearing**: the two generate routes catch it via
 * `instanceof WorkerError && err.status === 503`, so it is defined here once and
 * re-exported (never redefined) through the adapter and the
 * `_lib/worker.ts` shim. `body` is the worker's response text, sliced to the
 * first 500 chars by the adapter.
 */
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

export type ClusterRouting = {
  // Cluster hexes, in the order /sample-colors returned them. `routes[i]` is
  // the index into `palette` that cluster[i] should map to, or -1 for unrouted
  // (worker will fall back to Lab-ΔE nearest).
  clusters: string[];
  routes: number[];
};

export type SampledColor = {
  hex: string;
  rgb: [number, number, number];
  count: number;
  fraction: number;
};

export type SampledColors = {
  colors: SampledColor[];
  total_pixels: number;
  total_distinct_colors: number;
  // Max pairwise RGB distance among returned cluster centroids, 0..~441.
  // Low values flag monochromatic / low-contrast images so downstream stages
  // (AI palette pick, trace background-strip) can adjust their assumptions.
  cluster_spread: number;
};

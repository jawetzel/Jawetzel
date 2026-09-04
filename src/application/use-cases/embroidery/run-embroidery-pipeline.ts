import { type EmbroideryComputeGateway } from "@/application/ports/embroidery-compute-gateway";
import { type ObjectStore } from "@/application/ports/object-store";
import { type LocalArtifactSink } from "@/application/ports/local-artifact-sink";
import {
  DEFAULT_COLORS,
  MAX_COLORS,
  MIN_COLORS,
  TEST_CUSTOMER_ID,
  extractZip,
  hashPng,
  validateCustomerId,
  validateSize,
} from "@/domain/embroidery/pipeline-validation";
import {
  type PaletteSelection,
  type TagSvgResult,
} from "@/application/ports/embroidery-ai-gateway";
import { type SelectedThread, type Thread } from "@/domain/embroidery/thread";
import {
  type ClusterRouting,
  type SampledColors,
} from "@/application/ports/embroidery-compute-gateway";

/**
 * RunEmbroideryPipeline — the generate orchestrator, lifted into an application
 * use-case. The body is the historical `runPipeline` verbatim: same stage
 * sequence, same `step()`/`plog()`/`perr()` logging, same artifact names /
 * content types / R2 keys (`embroidery/<customerId>/<hash>_<size>/…`), same
 * local-disk writes + ZIP extraction + `embroidery.bmp` publish, same
 * `PipelineResult`. The only change is dependency inversion: the Python compute,
 * R2, the AI palette/tag calls, the palette load, and the local-disk writes are
 * all injected, so the whole pipeline runs in a unit test against fakes — no
 * Docker, no R2, no OpenAI, no real disk.
 *
 * `src/app/embroidery/_lib/pipeline.ts` is now a thin wrapper that resolves this
 * use-case from the DB-free composition and calls `.execute(...)`, so all three
 * generate routes are byte-for-byte unchanged.
 *
 * The `SKIP_AI_PALETTE` debug toggle is preserved exactly (a module const, value
 * `true`, same bypass object) — behavior-preserving means the AI palette stays
 * skipped exactly as it is in the current working tree.
 *
 * See `docs/architecture/embroidery.md`.
 */

// DEBUG TOGGLE — when true, skips the selectPalette AI call and lets the
// worker quantize on its own (no thread constraint, no role: background
// strip, no cluster routing). Used to verify trace-stage behavior in
// isolation from AI palette decisions. Flip back to `false` before merge.
const SKIP_AI_PALETTE = true;

function plog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[pipeline ${ts}] ${msg}`);
}

function perr(step: string, err: unknown): never {
  const ts = new Date().toISOString().slice(11, 19);
  const e = err as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string; errno?: number; syscall?: string };
    stack?: string;
  };
  console.error(`[pipeline ${ts}] ${step} FAILED`);
  console.error(`  name: ${e?.name ?? "unknown"}`);
  console.error(`  message: ${e?.message ?? String(err)}`);
  if (e?.code) console.error(`  code: ${e.code}`);
  if (e?.cause) {
    console.error(`  cause.message: ${e.cause.message}`);
    console.error(`  cause.code: ${e.cause.code}`);
    console.error(`  cause.syscall: ${e.cause.syscall}`);
    console.error(`  cause.errno: ${e.cause.errno}`);
  }
  if (e?.stack) console.error(`  stack: ${e.stack}`);
  throw err;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  plog(`${name} start`);
  try {
    const out = await fn();
    plog(`${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return out;
  } catch (err) {
    plog(`${name} threw after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    perr(name, err);
  }
}

export type PipelineResult = {
  key: string;
  customerId: string;
  hash: string;
  size: string;
  colors: number;
  artifacts: string[];
  urls: Record<string, string>;
  localDir: string;
};

export type PipelineOptions = {
  customerId?: string;
  manufacturer?: string;
  threadNumbers?: string[];
};

/**
 * The AI palette step (`select-palette.ts` `selectPalette`) injected as a
 * function so a fake can stand in for it. It is gateway-backed today.
 */
export type SelectPaletteFn = (
  pngUrl: string,
  available: Thread[],
  sampled: SampledColors | null,
  maxThreads: number,
) => Promise<PaletteSelection>;

/**
 * The SVG tag/clean step (`tag-svg.ts` `tagSvg`) injected as a function so a
 * fake can stand in for it. It is gateway-backed today.
 */
export type TagSvgFn = (
  svgBytes: Uint8Array,
  pngUrl: string,
  size: string,
  options: {
    threadPalette?: Thread[];
    clusterRouting?: ClusterRouting;
    applyUnderlay?: boolean;
  },
) => Promise<TagSvgResult>;

/**
 * The bundled-`.gpl` palette load (`gpl-palette.ts`). Injected as functions
 * because `gpl-palette.ts` is the DEFERRED build-fragile piece (`readFileSync`
 * of the Ink/Stitch `.gpl` catalog via `new URL(..., import.meta.url)`); it
 * stays flat and is called transitionally through these deps.
 */
export type LoadPaletteFn = (manufacturer: string) => Thread[];
export type FilterAvailableFn = (
  manufacturer: string,
  threads: Thread[],
  availableNumbers: string[] | null | undefined,
) => Thread[];

export interface RunEmbroideryPipelineDeps {
  /** Python embroidery-compute microservice (trace / sampleColors / convert). */
  compute: EmbroideryComputeGateway;
  /** R2 blob store — every artifact is uploaded here. */
  objectStore: ObjectStore;
  /** Local-disk mirror of every artifact + extracted ZIP entry. */
  localArtifacts: LocalArtifactSink;
  /** AI thread-palette selection (gateway-backed; injected for testability). */
  selectPalette: SelectPaletteFn;
  /** AI SVG tag/clean step (gateway-backed; injected for testability). */
  tagSvg: TagSvgFn;
  /** Bundled-`.gpl` palette load (deferred/flat — called transitionally). */
  loadPalette: LoadPaletteFn;
  /** Bundled-`.gpl` available-thread filter (deferred/flat). */
  filterAvailable: FilterAvailableFn;
  /** The default manufacturer key (`gpl-palette.DEFAULT_MANUFACTURER`). */
  defaultManufacturer: string;
}

export interface RunEmbroideryPipeline {
  execute(
    pngBytes: Uint8Array,
    sizeRaw: string,
    colorsRaw?: number,
    opts?: PipelineOptions,
  ): Promise<PipelineResult>;
}

export function createRunEmbroideryPipeline(
  deps: RunEmbroideryPipelineDeps,
): RunEmbroideryPipeline {
  const {
    compute,
    objectStore,
    localArtifacts,
    selectPalette,
    tagSvg,
    loadPalette,
    filterAvailable,
    defaultManufacturer,
  } = deps;

  return {
    async execute(
      pngBytes: Uint8Array,
      sizeRaw: string,
      colorsRaw?: number,
      opts: PipelineOptions = {},
    ): Promise<PipelineResult> {
      const size = validateSize(sizeRaw);
      const customerId = validateCustomerId(opts.customerId ?? TEST_CUSTOMER_ID);
      const colors = Math.max(
        MIN_COLORS,
        Math.min(
          MAX_COLORS,
          Number.isFinite(colorsRaw) ? Math.round(colorsRaw as number) : DEFAULT_COLORS,
        ),
      );
      const manufacturer = (opts.manufacturer ?? defaultManufacturer).toLowerCase();
      const fullPalette = loadPalette(manufacturer);
      const availableThreads = filterAvailable(
        manufacturer,
        fullPalette,
        opts.threadNumbers ?? null,
      );
      const hash = hashPng(pngBytes);
      const prefix = `embroidery/${customerId}/${hash}_${size}/`;
      // One fixed folder inside the project, overwritten every run — stable
      // "latest output" path regardless of input image.
      const localDir = localArtifacts.localDir;
      await localArtifacts.ensureDir();
      plog(
        `start customer=${customerId} hash=${hash} size=${size} colors=${colors} localDir=${localDir}`,
      );

      const persist = async (
        name: string,
        bytes: Uint8Array,
        contentType: string,
      ): Promise<void> => {
        await Promise.all([
          objectStore.upload(`${prefix}${name}`, bytes, contentType),
          localArtifacts.write(name, bytes),
        ]);
      };

      await step("persist input.png", () => persist("input.png", pngBytes, "image/png"));
      const pngUrl = objectStore.publicUrl(`${prefix}input.png`);

      // Full-res, high-N sampling so the AI sees the exact cluster set the trace
      // stage will bucket against. 256 is PIL's quantize cap and generous enough
      // to capture every perceptible cluster in a rich illustration.
      const sampled = await step("sampleColors", () => compute.sampleColors(pngBytes, 256, true, size))
        .catch((err) => {
          // Worker is best-effort here — if /sample-colors fails, the AI step still
          // runs (with weaker context) and the trace falls back to RGB-nearest.
          plog(`sampleColors failed (${err}); continuing without cluster routing`);
          return null;
        });
      if (sampled) {
        if (sampled.colors.length === 0) {
          // Sampling succeeded structurally but returned no usable clusters — most
          // commonly because every cluster centroid passed the paper-strip filter
          // (e.g. an almost-entirely-white watercolor with chroma below the threshold).
          // Without clusters, the cluster-routing path can't engage and trace falls
          // back to RGB-nearest, which is what we're explicitly trying to avoid.
          plog(
            `WARN sampleColors returned 0 usable clusters from ${sampled.total_distinct_colors.toLocaleString()} distinct RGB values — cluster routing disabled this run, trace will use RGB-nearest`,
          );
        } else {
          plog(
            `sampled ${sampled.colors.length} clusters from ${sampled.total_distinct_colors.toLocaleString()} distinct RGB values ` +
              `(${sampled.total_pixels.toLocaleString()} subject pixels, cluster_spread=${sampled.cluster_spread}/441)`,
          );
        }
      }

      const selection = SKIP_AI_PALETTE
        ? (() => {
            plog("SKIP_AI_PALETTE=true — bypassing selectPalette AI; worker will quantize unconstrained");
            return {
              threads: [] as SelectedThread[],
              extractOutline: true,
              routing: null,
              rationale: "AI palette skipped via SKIP_AI_PALETTE debug flag",
            } satisfies PaletteSelection;
          })()
        : await step("selectPalette (AI)", () =>
            selectPalette(pngUrl, availableThreads, sampled, colors),
          );
      const selectedThreads = selection.threads;
      const paletteHex = selectedThreads.map((t) => t.hex);
      plog(
        `picked ${selectedThreads.length} threads from ${manufacturer} ` +
          `(extract_outline=${selection.extractOutline}): ` +
          selectedThreads.map((t) => `${t.number}:${t.hex}(${t.name})`).join(", "),
      );
      if (selection.routing) {
        const { aiRouted, fallback } = selection.routing;
        const total = aiRouted + fallback;
        const pct = total > 0 ? Math.round((aiRouted / total) * 100) : 0;
        plog(
          `AI routed ${aiRouted}/${total} clusters (${pct}%); ${fallback} fell back to Lab-ΔE nearest`,
        );
      }
      await step("persist palette.json", () =>
        persist(
          "palette.json",
          new TextEncoder().encode(
            JSON.stringify(
              {
                manufacturer,
                available_count: availableThreads.length,
                extract_outline: selection.extractOutline,
                rationale: selection.rationale ?? null,
                selected: selectedThreads,
                routing: selection.routing,
              },
              null,
              2,
            ),
          ),
          "application/json",
        ),
      );

      const tracedSvgBytes = await step("traceImage", () =>
        compute.trace(
          pngBytes,
          size,
          colors,
          paletteHex,
          selection.extractOutline,
          selection.routing ?? undefined,
          // AI-marked "background" threads get ripped out entirely — no trace
          // layer, no stitches. Those pixels stay as fabric. Honors the role
          // label the AI already emits.
          selectedThreads
            .map((t, i) => (t.role === "background" ? i : -1))
            .filter((i) => i >= 0),
        ),
      );
      plog(`traced.svg ${tracedSvgBytes.length} bytes`);
      await step("persist traced.svg", () =>
        persist("traced.svg", tracedSvgBytes, "image/svg+xml"),
      );

      const { cleanedSvgBytes, taggedSvgBytes, geometryReport, aiTags } = await step(
        "tagSvg (AI)",
        () =>
          tagSvg(tracedSvgBytes, pngUrl, size, {
            threadPalette: selectedThreads,
            // Routing is the AI's cluster → thread map. Pass it through so the
            // post-trace snap honors the AI's semantic decisions instead of
            // re-picking the RGB-nearest thread.
            ...(selection.routing
              ? {
                  clusterRouting: {
                    clusters: selection.routing.clusters,
                    routes: selection.routing.routes,
                  },
                }
              : {}),
            // Photos (extract_outline=false) have hundreds of small paths where
            // underlay is wasted compute. Line-art keeps underlay for clean fills.
            applyUnderlay: selection.extractOutline,
          }),
      );

      await step("persist cleaned.svg", () =>
        persist("cleaned.svg", cleanedSvgBytes, "image/svg+xml"),
      );
      const geometryBytes = new TextEncoder().encode(JSON.stringify(geometryReport, null, 2));
      await step("persist geometry.json", () =>
        persist("geometry.json", geometryBytes, "application/json"),
      );
      await step("persist tagged.svg", () =>
        persist("tagged.svg", taggedSvgBytes, "image/svg+xml"),
      );

      const artifacts = [
        "input.png",
        "palette.json",
        "traced.svg",
        "cleaned.svg",
        "geometry.json",
        "tagged.svg",
      ];
      if (aiTags) {
        const aiTagsBytes = new TextEncoder().encode(JSON.stringify(aiTags, null, 2));
        await step("persist ai-tags.json", () =>
          persist("ai-tags.json", aiTagsBytes, "application/json"),
        );
        artifacts.push("ai-tags.json");
      }

      const zipBytes = await step("convertSvg", () => compute.convert(taggedSvgBytes, size));
      plog(`out.zip ${zipBytes.length} bytes`);
      await step("persist out.zip", () =>
        persist("out.zip", zipBytes, "application/zip"),
      );
      artifacts.push("out.zip");

      // Also extract the zip's contents into the local dir so the .dst/.pes/.svg
      // files are directly usable without unzipping. Additionally publish
      // embroidery.bmp to R2 — it's the rendered stitch preview shown in the
      // generations list and on /embroidery, so it has to be reachable by URL.
      await step("extract out.zip locally", async () => {
        const entries = extractZip(zipBytes);
        await Promise.all(
          [...entries].map(([name, data]) => localArtifacts.write(name, data)),
        );
        plog(`extracted ${entries.size} files: ${[...entries.keys()].join(", ")}`);
        const bmp = entries.get("embroidery.bmp");
        if (bmp) {
          await persist("embroidery.bmp", bmp, "image/bmp");
          artifacts.push("embroidery.bmp");
        } else {
          plog("warning: embroidery.bmp missing from zip — preview will be null");
        }
      });

      plog(`pipeline complete, local dir: ${localDir}`);

      const urls = Object.fromEntries(
        artifacts.map((name) => [name, objectStore.publicUrl(`${prefix}${name}`)]),
      );

      return { key: prefix, customerId, hash, size, colors, artifacts, urls, localDir };
    },
  };
}

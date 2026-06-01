import { getRunEmbroideryPipeline } from "@/composition/embroidery-pipeline";
import {
  type PipelineOptions,
  type PipelineResult,
} from "@/application/use-cases/embroidery/run-embroidery-pipeline";

/**
 * Thin wrapper over the {@link RunEmbroideryPipeline} use-case.
 *
 * The ~389-LOC orchestration moved verbatim into
 * `application/use-cases/embroidery/run-embroidery-pipeline.ts`, behind injected
 * collaborators — the Python compute (`EmbroideryComputeGateway`), R2
 * (`ObjectStore`), the AI palette/tag calls + the bundled-`.gpl` palette load
 * (injected functions), and a new `LocalArtifactSink` for the `tmp/embroidery`
 * disk mirror + ZIP extraction. `runPipeline` keeps its exact historical
 * signature + return shape and one-line-delegates to the singleton wired in the
 * DB-free `composition/embroidery-pipeline.ts`, so all three generate routes
 * (`/embroidery/api/generate`, `/embroidery/api/generate-from-url`,
 * `/api/embroidery/generate`) stay byte-for-byte unchanged.
 *
 * The pure value-object constructors + constants + errors + types
 * (`validateSize` / `validateCustomerId` / `ALLOWED_SIZES` /
 * `TEST_CUSTOMER_ID` / `DEFAULT_COLORS` / `MIN_COLORS` / `MAX_COLORS` /
 * `InvalidSizeError` / `InvalidCustomerIdError` / `AllowedSize`) moved to
 * `domain/embroidery/pipeline-validation.ts` and are **re-exported here** so the
 * routes' imports from `_lib/pipeline` stay unchanged. `SKIP_AI_PALETTE = true`
 * is preserved verbatim inside the use-case (the AI palette stays skipped).
 */

export {
  DEFAULT_COLORS,
  MIN_COLORS,
  MAX_COLORS,
  ALLOWED_SIZES,
  TEST_CUSTOMER_ID,
  InvalidSizeError,
  InvalidCustomerIdError,
  validateSize,
  validateCustomerId,
  type AllowedSize,
} from "@/domain/embroidery/pipeline-validation";

export type { PipelineResult, PipelineOptions };

export function runPipeline(
  pngBytes: Uint8Array,
  sizeRaw: string,
  colorsRaw?: number,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  return getRunEmbroideryPipeline().execute(pngBytes, sizeRaw, colorsRaw, opts);
}

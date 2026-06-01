import {
  createRunEmbroideryPipeline,
  type RunEmbroideryPipeline,
} from "@/application/use-cases/embroidery/run-embroidery-pipeline";
import { getEmbroideryComputeGateway } from "@/composition/embroidery-compute";
import { getObjectStore } from "@/composition/object-store";
import { DiskLocalArtifactSink } from "@/infrastructure/embroidery/disk-local-artifact-sink";
import { selectPalette } from "@/app/embroidery/_lib/ai/select-palette";
import { tagSvg } from "@/app/embroidery/_lib/ai/tag-svg";
import {
  DEFAULT_MANUFACTURER,
  filterAvailable,
  loadPalette,
} from "@/app/embroidery/_lib/inkstitch/gpl-palette";

/**
 * Embroidery-pipeline composition root — wiring for the
 * {@link RunEmbroideryPipeline} use-case, kept **DB-free** and separate from the
 * main `container.ts` on purpose, the same reasoning as
 * `composition/embroidery-compute.ts` / `composition/object-store.ts` /
 * `composition/llm.ts`: the pipeline touches **no Mongo** (generation
 * persistence stays flat in the routes via `lib/users`), but `src/lib/mongodb.ts`
 * connects (and throws on a missing `DATABASE_URL`) at import time. Routing the
 * pipeline through the DB-backed container would drag Mongo into all three
 * generate routes for nothing — a regression. So the use-case gets its own
 * DB-free composition.
 *
 * The collaborators are composed from the already-DB-free roots:
 * `getEmbroideryComputeGateway()` (the Python service), `getObjectStore()` (R2),
 * a `DiskLocalArtifactSink` (the `tmp/embroidery` mirror), and the still-flat
 * AI palette/tag functions (`selectPalette` / `tagSvg`, gateway-backed) + the
 * still-flat bundled-`.gpl` palette load (`loadPalette` / `filterAvailable` —
 * the deferred build-fragile piece; it stays flat and is wired transitionally).
 *
 * Singleton because the old `runPipeline` was a module-level function — the
 * wrapper resolves one instance.
 */
let runEmbroideryPipeline: RunEmbroideryPipeline | null = null;

export function getRunEmbroideryPipeline(): RunEmbroideryPipeline {
  if (!runEmbroideryPipeline) {
    runEmbroideryPipeline = createRunEmbroideryPipeline({
      compute: getEmbroideryComputeGateway(),
      objectStore: getObjectStore(),
      localArtifacts: new DiskLocalArtifactSink(),
      selectPalette,
      tagSvg,
      loadPalette,
      filterAvailable,
      defaultManufacturer: DEFAULT_MANUFACTURER,
    });
  }
  return runEmbroideryPipeline;
}

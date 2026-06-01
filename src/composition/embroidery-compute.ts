import { HttpEmbroideryWorker } from "@/infrastructure/embroidery/http-embroidery-worker";
import { type EmbroideryComputeGateway } from "@/application/ports/embroidery-compute-gateway";

/**
 * Embroidery-compute composition root — wiring for the
 * {@link EmbroideryComputeGateway} port, kept separate from the main
 * `container.ts` on purpose: it imports only the `HttpEmbroideryWorker`
 * adapter, never the Mongo/Brevo adapters. That matters because
 * `src/lib/mongodb.ts` connects (and throws on a missing `DATABASE_URL`) at
 * import time, and the gateway is reached by the embroidery pipeline, both
 * generate routes, and the AI palette step — none of which need Mongo here.
 * The old `_lib/worker.ts` had **zero** Mongo coupling; routing the shim
 * through the DB-backed container would drag Mongo into those import sites for
 * nothing. So the gateway gets its own DB-free composition, mirroring
 * `composition/object-store.ts` (`HttpEmbroideryWorker` is stateless — it only
 * reads the `WORKER_URL` env var per request).
 *
 * (Composition may be more than one module — the rule is that adapters are
 * imported *only* in composition, not that there's a single function.)
 */
const embroideryComputeGateway: EmbroideryComputeGateway =
  new HttpEmbroideryWorker();

export function getEmbroideryComputeGateway(): EmbroideryComputeGateway {
  return embroideryComputeGateway;
}

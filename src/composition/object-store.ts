import { R2ObjectStore } from "@/infrastructure/object-store/r2-object-store";
import { type ObjectStore } from "@/application/ports/object-store";

/**
 * Object-store composition root — wiring for the {@link ObjectStore} port,
 * kept separate from the main `container.ts` on purpose: it imports only the
 * R2 adapter, never the Mongo/Brevo adapters. That matters because
 * `src/lib/mongodb.ts` connects (and throws on a missing `DATABASE_URL`) at
 * import time, and the object store is reached by five widely-spread modules
 * (the embroidery pipeline, the upload route, the supply-feed worker job, the
 * supply-feed reader, the download-links route). Routing them through the
 * DB-backed container would drag Mongo into every one of those import sites — a
 * regression. So the object store gets its own DB-free composition, mirroring
 * `composition/content.ts` (`R2ObjectStore` needs no Mongo — only the R2 env
 * vars).
 *
 * (Composition may be more than one module — the rule is that adapters are
 * imported *only* in composition, not that there's a single function. Once
 * `mongodb.ts` is made lazy, these could merge.)
 */
const objectStore: ObjectStore = new R2ObjectStore();

export function getObjectStore(): ObjectStore {
  return objectStore;
}

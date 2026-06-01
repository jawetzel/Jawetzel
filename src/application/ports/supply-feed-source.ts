/**
 * SupplyFeedSource — a driven port for one embroidery-supply vendor's catalog
 * pull.
 *
 * Consumer-owned: the supply-feed refresh orchestrator
 * (`src/worker/jobs/refresh-embroidery-supplies.ts`) iterates a list of these,
 * archives each vendor's payload to R2, and (via `onlyVendor`) filters by
 * `name`. It says "give me this vendor's curated payload," never "fetch this
 * Magento GraphQL endpoint" / "parse this HTML" — the wire protocol, the
 * pagination, the auth-gating, and the curation are all adapter details behind
 * this boundary, one adapter per vendor in `infrastructure/supply-feed/`.
 *
 * Shaped to exactly what the orchestrator consumes today: a `name` (the R2 path
 * segment + the `onlyVendor` match key) and a `pull()` returning the curated
 * payload. The payload is `unknown` on purpose — each vendor returns its own
 * `<Vendor>PullResult` shape, and the orchestrator only JSON-stringifies it for
 * archival; the compile step reads those shapes back from R2 separately.
 *
 * The production adapters wrap the unchanged `src/worker/jobs/sources/<vendor>-pull`
 * parsers (relocating those files into infrastructure is a deferred cleanup);
 * the sources are wired DB-free in `composition/supply-feed.ts`.
 *
 * See `docs/architecture/worker.md` → The supply-feed refresh.
 */
export interface SupplyFeedSource {
  /** Vendor identifier — the R2 path segment and the `onlyVendor` match key. */
  readonly name: string;

  /** Pull the vendor's curated catalog payload (vendor-specific shape). */
  pull(): Promise<unknown>;
}

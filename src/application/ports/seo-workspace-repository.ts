import { type IntelRun, type SeoTag } from "@/domain/seo/workspace";

/**
 * SeoWorkspaceRepository — persistence for customer tags and their intel runs.
 *
 * This is the "history of lookups" surface: a tag names an engagement, and its
 * runs are everything that has been pulled for that property over time.
 *
 * **Distinct from the corpus.** `SeoCorpusRepository` holds public observation —
 * SERPs, ranked keywords, keyword metrics — and pools across every caller
 * because nobody owns what ranks for a query. This port holds the *workspace*:
 * which engagements exist, which keyword lists were submitted, which
 * competitors a human approved. It never pools.
 *
 * **Two collections are designed but not yet built**, and are recorded here so
 * they are not retrofitted into an incompatible shape:
 *
 * - `seo_gap_keywords`, keyed `(tag, keyword)` and **upserted** — layer 2's
 *   merged pile. Upsert rather than replace is load-bearing: a refresh that
 *   overwrote the pile would take every routing decision attached to it down
 *   with it.
 * - `seo_routings`, keyed `(tag, pageUrl, keyword)` — one row per verdict the
 *   router emits, plus any human override. The backlog is *"never claimed as
 *   Improve or Enrich by any page run"*, which is set math over this table, so
 *   it has to be durable from the first run. It cannot be reconstructed at
 *   page 20 from runs that only stored their own output.
 */
export interface SeoWorkspaceRepository {
  /** Create or replace a tag. Keyed on `tag`, which is unique. */
  saveTag(tag: SeoTag): Promise<void>;
  findTag(tag: string): Promise<SeoTag | null>;
  listTags(): Promise<SeoTag[]>;

  /** Create or replace a run. Keyed on `runId`. */
  saveRun(run: IntelRun): Promise<void>;
  findRun(runId: string): Promise<IntelRun | null>;
  /** A tag's runs, newest first. */
  listRuns(input: { tag: string; limit: number }): Promise<IntelRun[]>;
}

import { type Swap } from "@/domain/seo/swaps";
import { type WorkOrder } from "@/domain/seo/work-order";

/**
 * SeoAnalysisRepository — the *derived* analysis-history layer of seo.md Part 4
 * (its `page_analysis` collection: "one row per page per run").
 *
 * This is deliberately a **separate port** from {@link SeoCorpusRepository}. The
 * corpus stores raw, permanent observations and its contract forbids storing
 * conclusions — "no swaps, no scores, no verdicts." A run's swaps and scores are
 * exactly those conclusions: derived, stamped with `formulaVersion`, and
 * regenerable from the raw corpus at any time. seo.md keeps the two apart ("Raw
 * — permanent, never deleted" vs. "Derived — regenerable, safe to drop"), so the
 * ports do too.
 *
 * Because it is regenerable, a write here is best-effort: a persistence failure
 * must never fail a completed analysis (the caller already has its answer).
 */

/** The measurement context for a run — mirrors the analyze response's `sample`. */
export interface AnalysisSample {
  competitors: number;
  crawled: number;
  crawlFailures: number;
  serpCapturedAt: string;
  serpFromCorpus: boolean;
  ourPosition: number | null;
  features: string[];
}

/** One row of `seo_page_analysis` — the durable core of a single run. */
export interface StoredPageAnalysis {
  /**
   * Stable row id. Absent on the way in (the store assigns it), present on the
   * way out — the work-order renderer addresses a run by it, which is what lets
   * a rendering re-run for tokens alone with no vendor call.
   */
  id?: string;
  /** Registrable domain of the analyzed URL. Private by construction. */
  propertyId: string;
  url: string;
  query: string;
  location: string;
  /** ISO timestamp the run was produced (the response's `analyzedAt`). */
  runAt: string;
  /** Stamped so runs stay comparable as detectors change (seo.md Part 4). */
  formulaVersion: string;
  swaps: Swap[];
  sample: AnalysisSample;
}

export interface SeoAnalysisRepository {
  /**
   * Append one run and return its assigned id. Rows are never updated in place.
   *
   * The id is returned rather than discarded so the analyze response can carry
   * it, which is what lets the work-order renderer address the run afterwards
   * without a lookup by url and query.
   */
  save(record: StoredPageAnalysis): Promise<string>;

  /** The most recent runs across all properties, newest first. */
  listRecent(input: { limit: number }): Promise<StoredPageAnalysis[]>;

  /** One run by id — what the work-order renderer reads. */
  findById(id: string): Promise<StoredPageAnalysis | null>;

  /**
   * Cache one rendered work order against its analysis.
   *
   * A **cache**, not a source of truth: the work order is regenerable from the
   * stored swaps for tokens alone, and is stamped with `rendererVersion` and
   * the model that wrote it so a stale rendering is recognizable rather than
   * silently authoritative. Kept out of the analysis row itself so that
   * collection stays append-only.
   */
  saveWorkOrder(input: { analysisId: string; workOrder: WorkOrder }): Promise<void>;

  findWorkOrder(analysisId: string): Promise<WorkOrder | null>;
}

import { type SerpObservation } from "@/domain/seo/serp-facts";
import { type RankedKeywordsObservation } from "@/domain/seo/competitor-queries";
import { type KeywordMetric } from "@/application/ports/keyword-metrics-gateway";

/**
 * SeoCorpusRepository — the raw, permanent layer of seo.md Part 4.
 *
 * "Store raw observations, never conclusions." A raw observation is perishable:
 * if we don't record what the SERP looked like on 2026-07-22, that fact is gone
 * forever. Conclusions are recomputable and *will* change as the formulas
 * improve, so nothing derived is stored behind this port — no swaps, no scores,
 * no verdicts.
 *
 * The privacy line from Part 4c is drawn in the *shape* of this interface, not
 * in a policy document:
 *
 *   - `serp_snapshots` / `keyword_metrics` key on `(query, location)` with NO
 *     property identifier. Nobody owns what ranks for a query — this is public
 *     observation, and it pools across every caller. That pooling is the
 *     flywheel: more consumers → more queries observed → better volatility and
 *     trajectory data for everyone.
 *   - `ranked_keywords` keys on `(target, location)` — also public observation
 *     (what a domain ranks for is visible to anyone who looks), so it pools the
 *     same way. The `target` is whoever was observed, usually a competitor.
 *   - `page_snapshots` carries `propertyId`. It is the caller's own content and
 *     never pools.
 *
 * Retention: none. "Do not build pruning or retention logic — deleting old data
 * to save a few dollars trades away the only thing here that cannot be bought
 * back."
 */

/** One row of `seo_page_snapshots` — written only when `contentHash` changes. */
export interface PageSnapshotRow {
  /** Registrable domain of the analyzed URL. Private by construction. */
  propertyId: string;
  url: string;
  capturedAt: string;
  contentHash: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  headings: Array<{ level: number; text: string }>;
  wordCount: number;
  schemaTypes: string[];
  canonical: string | null;
  statusCode: number;
  internalLinksOut: number;
  imagesTotal: number;
  imagesMissingAlt: number;
}

export interface SeoCorpusRepository {
  /**
   * The most recent snapshot for `(query, location)` no older than `maxAgeDays`,
   * or null. Not a cache in the cost-saving sense — seo.md is explicit that cost
   * is not a design constraint — but a synchronous caller should not pay 15s of
   * latency to re-observe a SERP that hasn't meaningfully moved since morning.
   */
  findRecentSnapshot(input: {
    query: string;
    location: string;
    maxAgeDays: number;
  }): Promise<SerpObservation | null>;

  /** Every snapshot for `(query, location)` captured at/after `since`, oldest first. */
  findSnapshots(input: {
    query: string;
    location: string;
    since: string;
  }): Promise<SerpObservation[]>;

  /** Append one observation. Snapshots are never updated in place. */
  saveSnapshot(observation: SerpObservation): Promise<void>;

  /** Insert a page snapshot. Callers skip this when the content hash is unchanged. */
  savePageSnapshot(row: PageSnapshotRow): Promise<void>;

  /** The stored content hash for a URL, or null if never seen. */
  latestPageContentHash(url: string): Promise<string | null>;

  /** Upsert on `(query, location)` — slow-moving market context. */
  upsertKeywordMetrics(input: {
    location: string;
    metrics: KeywordMetric[];
  }): Promise<void>;

  /** Stored metrics for these queries, freshest first, no older than `maxAgeDays`. */
  findKeywordMetrics(input: {
    queries: string[];
    location: string;
    maxAgeDays: number;
  }): Promise<KeywordMetric[]>;

  /**
   * The most recent ranked-keywords observation for `(target, location)` no
   * older than `maxAgeDays`, or null. Rankings are slow-moving (seo.md Part 3
   * refreshes them quarterly), so a fresh stored observation spares the paid
   * call the same way a SERP snapshot does.
   */
  findRecentRankedKeywords(input: {
    target: string;
    location: string;
    maxAgeDays: number;
  }): Promise<RankedKeywordsObservation | null>;

  /** Append one observation. Like SERP snapshots, never updated in place. */
  saveRankedKeywords(observation: RankedKeywordsObservation): Promise<void>;
}

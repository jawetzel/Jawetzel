/**
 * KeywordMetricsGateway — a driven port for fact family 4: volume, CPC,
 * competition, difficulty, and intent for a set of queries (seo.md §4b).
 *
 * Consumer-owned. Batch-shaped on purpose: DataForSEO bills per *task* plus per
 * *row*, and the task fee dominates — Google Ads search volume is one flat fee
 * for up to 1,000 keywords, so "requesting 40 costs the same as requesting
 * 1,000" (seo.md §0, "Batch to the cap"). A per-query signature would make the
 * expensive shape the easy one, so the port doesn't offer it.
 *
 * These metrics are slow-moving (quarterly refresh per seo.md Part 3), which is
 * why the use-case reads them from the corpus first and only calls this port on
 * a miss.
 */

export interface KeywordMetric {
  query: string;
  /** Average monthly searches, or null when the vendor has no data. */
  searchVolume: number | null;
  cpc: number | null;
  /** 0–1 paid competition index. */
  competition: number | null;
  /** 0–100 organic ranking difficulty. */
  difficulty: number | null;
  /** `informational` | `commercial` | `navigational` | `transactional`. */
  intent: string | null;
  /** Up to four years of `{year, month, searchVolume}`, oldest first. */
  monthlySearches: Array<{
    year: number;
    month: number;
    searchVolume: number;
  }>;
  /** ISO-8601 observation time. */
  capturedAt: string;
}

export interface KeywordMetricsRequest {
  queries: string[];
  locationCode: number;
  languageCode: string;
}

export interface KeywordMetricsGateway {
  /**
   * Metrics for every query the vendor knows. Queries with no data are simply
   * absent from the result — never defaulted to zero, which would read as
   * "nobody searches this" rather than "we don't know".
   */
  fetchMetrics(request: KeywordMetricsRequest): Promise<KeywordMetric[]>;
}

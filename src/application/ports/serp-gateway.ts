import { type SerpObservation } from "@/domain/seo/serp-facts";
import { type Result } from "@/domain/shared/result";

/**
 * SerpGateway — a driven port for "what does page 1 actually look like right
 * now", the one question no first-party data source can answer (seo.md Part 1:
 * "Nothing Google provides will ever tell us what someone else ranks for").
 *
 * Consumer-owned. The production adapter is
 * `infrastructure/seo/DataForSeoSerpGateway`; tests use a fixture fake. The port
 * speaks the domain's `SerpObservation` so that vendor field names
 * (`rank_absolute`, `se_results_count`, …) stop at the adapter boundary and a
 * second vendor could be dropped in without touching a detector.
 *
 * The `cost` field rides along because seo.md is explicit that prices drift and
 * must never be hardcoded — we read what the response reports and record it.
 */

export interface SerpRequest {
  query: string;
  /** DataForSEO numeric location code (2840 = United States). */
  locationCode: number;
  /** ISO-639-1 language code. */
  languageCode: string;
  /** How many organic results to request. 10 = page one. */
  depth: number;
}

export interface SerpFetchResult {
  observation: SerpObservation;
  /** What the vendor reported this call cost, in USD. Never derived locally. */
  cost: number;
}

export type SerpGatewayError =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "NO_RESULTS"
  | "RATE_LIMITED";

export interface SerpGateway {
  fetchSerp(
    request: SerpRequest,
  ): Promise<Result<SerpFetchResult, SerpGatewayError>>;
}

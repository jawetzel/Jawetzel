import { type RankedKeywordsObservation } from "@/domain/seo/competitor-queries";
import { type Result } from "@/domain/shared/result";

/**
 * RankedKeywordsGateway — a driven port for "what queries does this domain
 * already win", seo.md Part 1's step 5 ("What do they rank for that I don't?").
 * Like the SERP, this is knowledge no first-party source can provide: Google
 * will never tell us what someone else ranks for.
 *
 * Consumer-owned. The production adapter is
 * `infrastructure/seo/DataForSeoRankedKeywordsGateway`; tests use a fixture
 * fake. The port speaks the domain's `RankedKeywordsObservation` so vendor
 * field names (`rank_group`, `keyword_info`, …) stop at the adapter boundary.
 *
 * `cost` rides along for the same reason it does on `SerpGateway`: prices
 * drift and must never be hardcoded — we record what the response reports.
 */

export interface RankedKeywordsRequest {
  /** Host key of the domain to observe (no scheme, no path). */
  target: string;
  /** DataForSEO numeric location code (2840 = United States). */
  locationCode: number;
  /** ISO-639-1 language code. */
  languageCode: string;
  /** Max rows to pull. The vendor bills per task plus per row. */
  limit: number;
}

export interface RankedKeywordsFetchResult {
  observation: RankedKeywordsObservation;
  /** What the vendor reported this call cost, in USD. Never derived locally. */
  cost: number;
}

export type RankedKeywordsGatewayError =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "NO_DATA"
  | "RATE_LIMITED";

export interface RankedKeywordsGateway {
  fetchRankedKeywords(
    request: RankedKeywordsRequest,
  ): Promise<Result<RankedKeywordsFetchResult, RankedKeywordsGatewayError>>;
}

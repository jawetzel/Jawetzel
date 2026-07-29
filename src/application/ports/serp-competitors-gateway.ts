import { type CompetitorSetObservation } from "@/domain/seo/competitor-set";
import { type Result } from "@/domain/shared/result";

/**
 * SerpCompetitorsGateway — a driven port for layer 1: "given these keywords, who
 * competes across them?"
 *
 * Distinct from {@link RankedKeywordsGateway}, which answers "what does *this*
 * domain rank for" one target at a time. This port answers the set question in
 * one call, and the answer — coverage across a keyword list — is not derivable
 * from any number of single-SERP observations without paying for all of them.
 *
 * Consumer-owned. The production adapter is
 * `infrastructure/seo/DataForSeoSerpCompetitorsGateway`; tests use a fixture
 * fake. `cost` rides along for the same reason it does on every other SEO port:
 * seo.md is explicit that quoted prices drift and must never be hardcoded, so we
 * record what the response reports.
 */

export interface SerpCompetitorsRequest {
  /** Normalized keyword list. The vendor bills per task plus per keyword. */
  keywords: string[];
  /** DataForSEO numeric location code (2840 = United States). */
  locationCode: number;
  /** ISO-639-1 language code. */
  languageCode: string;
  /** Max domains to pull. Ranking and trimming happen in the domain. */
  limit: number;
}

export interface SerpCompetitorsFetchResult {
  observation: CompetitorSetObservation;
  /** What the vendor reported this call cost, in USD. Never derived locally. */
  cost: number;
}

export type SerpCompetitorsGatewayError =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "NO_DATA"
  | "RATE_LIMITED";

export interface SerpCompetitorsGateway {
  fetchCompetitors(
    request: SerpCompetitorsRequest,
  ): Promise<Result<SerpCompetitorsFetchResult, SerpCompetitorsGatewayError>>;
}

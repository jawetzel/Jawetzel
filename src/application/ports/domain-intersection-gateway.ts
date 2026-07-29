import { type CompetitorGapRow } from "@/domain/seo/gap-pile";
import { type Result } from "@/domain/shared/result";

/**
 * DomainIntersectionGateway — a driven port for layer 2's core question: "what
 * does this competitor rank for that we don't?"
 *
 * **This overrules seo.md Part 1 step 5**, which says to compute the gap
 * locally by pulling `ranked_keywords` for both sides and set-differencing in
 * our own code. That advice is wrong for a reason the document could not have
 * known: `ranked_keywords` is row-capped and volume-ordered, so whenever *our*
 * side is truncated the difference invents gaps we do not actually have. The
 * vendor's own `intersections: false` mode is definitionally correct and does
 * not care how large either domain is.
 *
 * Consumer-owned. `cost` rides along as on every other SEO port — prices drift
 * and must never be hardcoded.
 */

export interface DomainIntersectionRequest {
  /** The competitor. Keywords *they* hold. */
  competitorDomain: string;
  /** Us. Keywords we hold are excluded from the result. */
  ourDomain: string;
  locationCode: number;
  languageCode: string;
  /** Max rows. The vendor returns them highest-volume first by default. */
  limit: number;
}

export interface DomainIntersectionFetchResult {
  competitorDomain: string;
  rows: CompetitorGapRow[];
  capturedAt: string;
  /** What the vendor reported this call cost, in USD. Never derived locally. */
  cost: number;
}

export type DomainIntersectionGatewayError =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "NO_DATA"
  | "RATE_LIMITED";

export interface DomainIntersectionGateway {
  fetchGap(
    request: DomainIntersectionRequest,
  ): Promise<
    Result<DomainIntersectionFetchResult, DomainIntersectionGatewayError>
  >;
}

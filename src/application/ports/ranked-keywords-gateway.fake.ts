import { ok, err, type Result } from "@/domain/shared/result";
import { type RankedKeywordsObservation } from "@/domain/seo/competitor-queries";
import {
  type RankedKeywordsFetchResult,
  type RankedKeywordsGateway,
  type RankedKeywordsGatewayError,
  type RankedKeywordsRequest,
} from "@/application/ports/ranked-keywords-gateway";

/**
 * Fixture {@link RankedKeywordsGateway}: a target → observation (or error) map,
 * recording each request so a test can prove a corpus hit spared the paid call
 * and that per-target failures stayed per-target.
 */
export class FakeRankedKeywordsGateway implements RankedKeywordsGateway {
  readonly requests: RankedKeywordsRequest[] = [];

  constructor(
    private readonly byTarget: Record<
      string,
      RankedKeywordsObservation | RankedKeywordsGatewayError
    > = {},
    private readonly cost = 0.11,
  ) {}

  async fetchRankedKeywords(
    request: RankedKeywordsRequest,
  ): Promise<Result<RankedKeywordsFetchResult, RankedKeywordsGatewayError>> {
    this.requests.push(request);
    const response = this.byTarget[request.target];
    if (response === undefined) return err("NO_DATA");
    if (typeof response === "string") return err(response);
    return ok({ observation: response, cost: this.cost });
  }
}

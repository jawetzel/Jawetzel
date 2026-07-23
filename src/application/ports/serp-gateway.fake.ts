import { ok, err, type Result } from "@/domain/shared/result";
import { type SerpObservation } from "@/domain/seo/serp-facts";
import {
  type SerpFetchResult,
  type SerpGateway,
  type SerpGatewayError,
  type SerpRequest,
} from "@/application/ports/serp-gateway";

/**
 * Fixture {@link SerpGateway}. Hand it an observation (or an error) and it
 * returns that, recording each request so a test can prove the corpus hit
 * spared the paid call.
 */
export class FakeSerpGateway implements SerpGateway {
  readonly requests: SerpRequest[] = [];

  constructor(
    private readonly response: SerpObservation | SerpGatewayError,
    private readonly cost = 0.002,
  ) {}

  async fetchSerp(
    request: SerpRequest,
  ): Promise<Result<SerpFetchResult, SerpGatewayError>> {
    this.requests.push(request);
    if (typeof this.response === "string") return err(this.response);
    return ok({ observation: this.response, cost: this.cost });
  }
}

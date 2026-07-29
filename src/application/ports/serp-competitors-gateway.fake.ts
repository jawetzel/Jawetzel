import { ok, err, type Result } from "@/domain/shared/result";
import { type CompetitorRow } from "@/domain/seo/competitor-set";
import {
  type SerpCompetitorsFetchResult,
  type SerpCompetitorsGateway,
  type SerpCompetitorsGatewayError,
  type SerpCompetitorsRequest,
} from "@/application/ports/serp-competitors-gateway";

/**
 * FakeSerpCompetitorsGateway — the port's test double.
 *
 * Records the requests it received so a test can assert the use-case passed the
 * tag's location and language through, and returns either a fixture row set or
 * a configured error.
 */
export class FakeSerpCompetitorsGateway implements SerpCompetitorsGateway {
  readonly requests: SerpCompetitorsRequest[] = [];

  constructor(
    private readonly outcome:
      | { rows: CompetitorRow[]; cost?: number; capturedAt?: string }
      | { error: SerpCompetitorsGatewayError },
  ) {}

  async fetchCompetitors(
    request: SerpCompetitorsRequest,
  ): Promise<Result<SerpCompetitorsFetchResult, SerpCompetitorsGatewayError>> {
    this.requests.push(request);
    if ("error" in this.outcome) return err(this.outcome.error);
    return ok({
      observation: {
        keywords: request.keywords,
        location: String(request.locationCode),
        capturedAt: this.outcome.capturedAt ?? "2026-07-28T00:00:00.000Z",
        rows: this.outcome.rows,
      },
      cost: this.outcome.cost ?? 0.02,
    });
  }
}

/** Terse fixture builder — only `domain` and `intersections` usually matter. */
export function competitorRow(
  domain: string,
  intersections: number,
  overrides: Partial<CompetitorRow> = {},
): CompetitorRow {
  return {
    domain,
    intersections,
    avgPosition: null,
    medianPosition: null,
    visibility: null,
    estimatedTraffic: null,
    ...overrides,
  };
}

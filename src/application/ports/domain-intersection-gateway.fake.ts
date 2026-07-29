import { ok, err, type Result } from "@/domain/shared/result";
import { type CompetitorGapRow } from "@/domain/seo/gap-pile";
import {
  type DomainIntersectionFetchResult,
  type DomainIntersectionGateway,
  type DomainIntersectionGatewayError,
  type DomainIntersectionRequest,
} from "@/application/ports/domain-intersection-gateway";

/**
 * FakeDomainIntersectionGateway — the port's test double.
 *
 * Outcomes are keyed by competitor domain so a test can make one competitor
 * fail while the others succeed, which is the case the use-case's
 * partial-failure handling exists for.
 */
export type IntersectionOutcome =
  | { rows: CompetitorGapRow[]; cost?: number }
  | { error: DomainIntersectionGatewayError };

export class FakeDomainIntersectionGateway implements DomainIntersectionGateway {
  readonly requests: DomainIntersectionRequest[] = [];

  constructor(
    private readonly byDomain: Record<string, IntersectionOutcome>,
    private readonly fallback: IntersectionOutcome = { rows: [] },
  ) {}

  async fetchGap(
    request: DomainIntersectionRequest,
  ): Promise<
    Result<DomainIntersectionFetchResult, DomainIntersectionGatewayError>
  > {
    this.requests.push(request);
    const outcome = this.byDomain[request.competitorDomain] ?? this.fallback;
    if ("error" in outcome) return err(outcome.error);
    return ok({
      competitorDomain: request.competitorDomain,
      rows: outcome.rows,
      capturedAt: "2026-07-28T00:00:00.000Z",
      cost: outcome.cost ?? 0.15,
    });
  }
}

/** Terse fixture builder. */
export function gapRow(
  keyword: string,
  position: number,
  overrides: Partial<CompetitorGapRow> = {},
): CompetitorGapRow {
  return {
    keyword,
    position,
    url: null,
    searchVolume: null,
    cpc: null,
    competition: null,
    difficulty: null,
    intent: null,
    ...overrides,
  };
}

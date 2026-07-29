import { ok, err, type Result } from "@/domain/shared/result";
import { type CompetitorGapRow } from "@/domain/seo/gap-pile";
import { hostKey } from "@/domain/seo/property-id";
import {
  type DomainIntersectionFetchResult,
  type DomainIntersectionGateway,
  type DomainIntersectionGatewayError,
  type DomainIntersectionRequest,
} from "@/application/ports/domain-intersection-gateway";
import {
  DataForSeoNotConfiguredError,
  isDataForSeoConfigured,
  postTask,
} from "./dataforseo-client";

/**
 * DataForSeoDomainIntersectionGateway — the production
 * {@link DomainIntersectionGateway}, on
 * `dataforseo_labs/google/domain_intersection/live`.
 *
 * `target1` is the competitor, `target2` is us, and **`intersections: false`**
 * flips the endpoint from "keywords both rank for" to "keywords target1 ranks
 * for and target2 doesn't" — which is the gap, directly, with no local set
 * arithmetic and no truncation hazard.
 *
 * **No `order_by`.** The endpoint's own default is already
 * `keyword_data.keyword_info.search_volume,desc`, so restating it buys nothing
 * and adds a field that can be rejected — as `serp_competitors` demonstrated.
 * Position filtering happens in the domain rather than in a vendor `filters`
 * clause for the same reason: a wrong filter path fails the whole task, and a
 * few extra rows cost less than a `40501`.
 *
 * Live rather than the task queue: a caller is waiting at layer 2's gate.
 *
 * Everything vendor-shaped stops here — `keyword_data.keyword_properties
 * .keyword_difficulty` and friends become flat domain fields.
 */

/** Only the fields we consume; every level is optional in practice. */
interface KeywordInfo {
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
}

interface IntersectionItem {
  keyword_data?: {
    keyword?: string;
    keyword_info?: KeywordInfo | null;
    keyword_properties?: { keyword_difficulty?: number | null } | null;
    search_intent_info?: { main_intent?: string | null } | null;
  } | null;
  /** target1 — the competitor, since that is the order we send them in. */
  first_domain_serp_element?: {
    type?: string;
    rank_group?: number;
    rank_absolute?: number;
    url?: string | null;
  } | null;
}

interface IntersectionTaskResult {
  items?: IntersectionItem[] | null;
}

export class DataForSeoDomainIntersectionGateway
  implements DomainIntersectionGateway
{
  async fetchGap(
    request: DomainIntersectionRequest,
  ): Promise<
    Result<DomainIntersectionFetchResult, DomainIntersectionGatewayError>
  > {
    if (!isDataForSeoConfigured()) return err("NOT_CONFIGURED");

    const competitorDomain = hostKey(request.competitorDomain);
    const ourDomain = hostKey(request.ourDomain);
    if (competitorDomain === "" || ourDomain === "") return err("NO_DATA");

    let response: { result: IntersectionTaskResult[]; cost: number };
    try {
      response = await postTask<IntersectionTaskResult>(
        "/dataforseo_labs/google/domain_intersection/live",
        {
          // The vendor wants bare domains — no scheme, no `www.`. `hostKey`
          // already guarantees both.
          target1: competitorDomain,
          target2: ourDomain,
          // The whole point of the call.
          intersections: false,
          location_code: request.locationCode,
          language_code: request.languageCode,
          // Default is ["organic","paid"]; ads are a different question.
          item_types: ["organic"],
          limit: request.limit,
        },
      );
    } catch (cause) {
      if (cause instanceof DataForSeoNotConfiguredError) {
        return err("NOT_CONFIGURED");
      }
      console.error(
        "[seo] DataForSEO domain_intersection request failed:",
        cause,
      );
      const status = (cause as { statusCode?: number }).statusCode;
      return err(status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR");
    }

    const [task] = response.result;
    if (!task) return err("NO_DATA");

    const rows: CompetitorGapRow[] = [];
    for (const item of task.items ?? []) {
      const keyword = item.keyword_data?.keyword?.trim().toLowerCase() ?? "";
      const element = item.first_domain_serp_element;
      // `rank_group` counts organic results only; `rank_absolute` counts every
      // block, so it reports position 7 for the top result under a large AI
      // Overview. Position means "where in the blue links".
      const position = element?.rank_group ?? element?.rank_absolute;
      if (keyword === "" || position === undefined) continue;

      const info = item.keyword_data?.keyword_info ?? null;
      rows.push({
        keyword,
        position,
        url: element?.url ?? null,
        searchVolume: info?.search_volume ?? null,
        cpc: info?.cpc ?? null,
        competition: info?.competition ?? null,
        difficulty:
          item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
      });
    }

    return ok({
      competitorDomain,
      rows,
      capturedAt: new Date().toISOString(),
      cost: response.cost,
    });
  }
}

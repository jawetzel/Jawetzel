import { ok, err, type Result } from "@/domain/shared/result";
import {
  type RankedKeywordRow,
  type RankedKeywordsObservation,
} from "@/domain/seo/competitor-queries";
import { hostKey } from "@/domain/seo/property-id";
import {
  type RankedKeywordsFetchResult,
  type RankedKeywordsGateway,
  type RankedKeywordsGatewayError,
  type RankedKeywordsRequest,
} from "@/application/ports/ranked-keywords-gateway";
import {
  DataForSeoNotConfiguredError,
  isDataForSeoConfigured,
  postTask,
} from "./dataforseo-client";

/**
 * DataForSeoRankedKeywordsGateway — the production {@link RankedKeywordsGateway},
 * on `dataforseo_labs/google/ranked_keywords/live`.
 *
 * Live rather than the task queue for the same reason the SERP adapter is: a
 * caller is synchronously waiting inside an open Discover request. The
 * cron-driven cold-start jobs (seo.md Part 1), when they land, must still queue.
 *
 * We ask the vendor for organic positions ≤ 20, volume-ordered: page one is
 * what "does well" means downstream, but 11–20 is striking-distance context
 * worth having in the corpus for free. Selection re-filters to ≤ 10 — the
 * threshold lives in the domain, not in a vendor filter nobody re-reads.
 *
 * Everything vendor-shaped stops here: `rank_group`, `keyword_info`,
 * `keyword_properties` are translated into the domain's observation so no
 * selector ever learns a DataForSEO field name.
 */

/** One item in the vendor's `items` array. Only the fields we consume. */
interface RankedKeywordItem {
  keyword_data?: {
    keyword?: string;
    keyword_info?: {
      search_volume?: number | null;
      cpc?: number | null;
      competition?: number | null;
    } | null;
    keyword_properties?: { keyword_difficulty?: number | null } | null;
    search_intent_info?: { main_intent?: string | null } | null;
  } | null;
  ranked_serp_element?: {
    serp_item?: {
      type?: string;
      rank_group?: number;
      rank_absolute?: number;
      url?: string | null;
    } | null;
  } | null;
}

interface RankedKeywordsTaskResult {
  target?: string;
  total_count?: number | null;
  items?: RankedKeywordItem[] | null;
}

/** Only positions this deep are pulled — see the class doc. */
const MAX_VENDOR_POSITION = 20;

export class DataForSeoRankedKeywordsGateway implements RankedKeywordsGateway {
  async fetchRankedKeywords(
    request: RankedKeywordsRequest,
  ): Promise<Result<RankedKeywordsFetchResult, RankedKeywordsGatewayError>> {
    if (!isDataForSeoConfigured()) return err("NOT_CONFIGURED");

    let response: { result: RankedKeywordsTaskResult[]; cost: number };
    try {
      response = await postTask<RankedKeywordsTaskResult>(
        "/dataforseo_labs/google/ranked_keywords/live",
        {
          target: request.target,
          location_code: request.locationCode,
          language_code: request.languageCode,
          limit: request.limit,
          // Highest-demand keywords first, so a row cap keeps the ones that
          // matter; the blue links only, close to page one.
          order_by: ["keyword_data.keyword_info.search_volume,desc"],
          filters: [
            ["ranked_serp_element.serp_item.type", "=", "organic"],
            "and",
            ["ranked_serp_element.serp_item.rank_group", "<=", MAX_VENDOR_POSITION],
          ],
        },
      );
    } catch (cause) {
      if (cause instanceof DataForSeoNotConfiguredError) {
        return err("NOT_CONFIGURED");
      }
      console.error("[seo] DataForSEO ranked_keywords request failed:", cause);
      const status = (cause as { statusCode?: number }).statusCode;
      return err(status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR");
    }

    const [task] = response.result;
    if (!task) return err("NO_DATA");

    const rows: RankedKeywordRow[] = [];
    for (const item of task.items ?? []) {
      const keyword = item.keyword_data?.keyword?.trim() ?? "";
      const serpItem = item.ranked_serp_element?.serp_item;
      const position = serpItem?.rank_group ?? serpItem?.rank_absolute;
      if (keyword === "" || position === undefined) continue;
      rows.push({
        keyword,
        position,
        url: serpItem?.url ?? null,
        searchVolume: item.keyword_data?.keyword_info?.search_volume ?? null,
        cpc: item.keyword_data?.keyword_info?.cpc ?? null,
        competition: item.keyword_data?.keyword_info?.competition ?? null,
        difficulty:
          item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
      });
    }

    if (rows.length === 0) return err("NO_DATA");

    const observation: RankedKeywordsObservation = {
      target: hostKey(task.target ?? request.target),
      location: String(request.locationCode),
      capturedAt: new Date().toISOString(),
      totalCount: task.total_count ?? null,
      rows: rows.sort(
        (a, b) => a.position - b.position || a.keyword.localeCompare(b.keyword),
      ),
    };

    return ok({ observation, cost: response.cost });
  }
}

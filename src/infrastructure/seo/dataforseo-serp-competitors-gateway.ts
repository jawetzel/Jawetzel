import { ok, err, type Result } from "@/domain/shared/result";
import {
  type CompetitorRow,
  type CompetitorSetObservation,
} from "@/domain/seo/competitor-set";
import { hostKey } from "@/domain/seo/property-id";
import {
  type SerpCompetitorsFetchResult,
  type SerpCompetitorsGateway,
  type SerpCompetitorsGatewayError,
  type SerpCompetitorsRequest,
} from "@/application/ports/serp-competitors-gateway";
import {
  DataForSeoNotConfiguredError,
  isDataForSeoConfigured,
  postTask,
} from "./dataforseo-client";

/**
 * DataForSeoSerpCompetitorsGateway — the production
 * {@link SerpCompetitorsGateway}, on
 * `dataforseo_labs/google/serp_competitors/live`.
 *
 * Live rather than the task queue for the same reason the SERP and
 * ranked-keywords adapters are: a caller is synchronously waiting at layer 1's
 * gate, and task_post/task_get would mean polling before the funnel can even
 * start. seo.md §0's "never use live mode" governs the cron jobs it was written
 * for; every interactive layer here pays the difference for an answer that
 * arrives while the request is open.
 *
 * **No `order_by`.** The endpoint accepts one, but its sortable fields are this
 * endpoint's own (`keywords_count`, `etv`, …) and an invalid name fails the
 * whole task with `40501` rather than degrading. Since `rankCompetitors` sorts
 * and trims in the domain anyway, the vendor ordering bought nothing except a
 * way for the request to be rejected. We ask for a generous `limit` instead and
 * do the selection ourselves.
 *
 * **Defensive field reading.** A missing field degrades that column to `null` —
 * which reads as "we don't know" — rather than throwing or, worse, reporting
 * zero. Only `domain` is load-bearing; a row without a usable one is skipped.
 *
 * Everything vendor-shaped stops here: `keywords_count` becomes the domain's
 * `intersections`, `etv` becomes `estimatedTraffic`, and no ranker or view ever
 * learns a DataForSEO field name.
 */

/**
 * One item in the vendor's `items` array. Only the fields we consume.
 *
 * Note `keywords_count` — how many of the *submitted* keywords this domain
 * ranks for. It is the discriminator the whole layer rests on, and it is not
 * the same as the `intersections` field on `competitors_domain`, a different
 * endpoint with a different response shape.
 */
interface CompetitorItem {
  domain?: string;
  avg_position?: number | null;
  median_position?: number | null;
  keywords_count?: number | null;
  visibility?: number | null;
  etv?: number | null;
}

interface CompetitorsTaskResult {
  se_type?: string;
  location_code?: number;
  items?: CompetitorItem[] | null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class DataForSeoSerpCompetitorsGateway implements SerpCompetitorsGateway {
  async fetchCompetitors(
    request: SerpCompetitorsRequest,
  ): Promise<Result<SerpCompetitorsFetchResult, SerpCompetitorsGatewayError>> {
    if (!isDataForSeoConfigured()) return err("NOT_CONFIGURED");
    if (request.keywords.length === 0) return err("NO_DATA");

    let response: { result: CompetitorsTaskResult[]; cost: number };
    try {
      response = await postTask<CompetitorsTaskResult>(
        "/dataforseo_labs/google/serp_competitors/live",
        {
          keywords: request.keywords,
          location_code: request.locationCode,
          language_code: request.languageCode,
          limit: request.limit,
          // Blue links only. Paid and local-pack occupants are a different
          // question than "who competes organically across this set".
          item_types: ["organic"],
        },
      );
    } catch (cause) {
      if (cause instanceof DataForSeoNotConfiguredError) {
        return err("NOT_CONFIGURED");
      }
      console.error("[seo] DataForSEO serp_competitors request failed:", cause);
      const status = (cause as { statusCode?: number }).statusCode;
      return err(status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR");
    }

    const [task] = response.result;
    if (!task) return err("NO_DATA");

    const rows: CompetitorRow[] = [];
    for (const item of task.items ?? []) {
      const domain = hostKey(item.domain ?? "");
      if (domain === "") continue;
      rows.push({
        domain,
        intersections: finiteOrNull(item.keywords_count) ?? 0,
        avgPosition: finiteOrNull(item.avg_position),
        medianPosition: finiteOrNull(item.median_position),
        visibility: finiteOrNull(item.visibility),
        estimatedTraffic: finiteOrNull(item.etv),
      });
    }

    if (rows.length === 0) return err("NO_DATA");

    const observation: CompetitorSetObservation = {
      keywords: request.keywords,
      location: String(request.locationCode),
      capturedAt: new Date().toISOString(),
      rows,
    };

    return ok({ observation, cost: response.cost });
  }
}

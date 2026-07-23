import { ok, err, type Result } from "@/domain/shared/result";
import { type SerpObservation, type SerpOrganicResult } from "@/domain/seo/serp-facts";
import { hostKey } from "@/domain/seo/property-id";
import {
  type SerpFetchResult,
  type SerpGateway,
  type SerpGatewayError,
  type SerpRequest,
} from "@/application/ports/serp-gateway";
import {
  DataForSeoNotConfiguredError,
  isDataForSeoConfigured,
  postTask,
} from "./dataforseo-client";

/**
 * DataForSeoSerpGateway — the production {@link SerpGateway}, on
 * `serp/google/organic/live/advanced`.
 *
 * **On `live` vs the task queue.** seo.md §0 says "never use live mode":
 * standard priority is $0.0006 per SERP against $0.002 live, a 70% saving "for a
 * delay nobody experiences", *because everything there runs from cron*. This
 * endpoint is the exception the principle didn't cover — a caller is
 * synchronously waiting on the response, and task_post/task_get means polling
 * for 30s+ before we can even start crawling competitors. We pay the $0.0014
 * difference for an answer that arrives while the request is still open. The
 * cron-driven jobs in Parts 1 and 3, when they land, must still use the queue.
 *
 * Everything vendor-shaped stops here: `rank_absolute`, `item.type`, and the
 * nested PAA structure are translated into the domain's `SerpObservation` so no
 * detector ever learns a DataForSEO field name.
 */

/** One item in DataForSEO's `items` array. Only the fields we consume. */
interface SerpItem {
  type?: string;
  rank_absolute?: number;
  rank_group?: number;
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  /** PAA and other block types nest their entries. */
  items?: Array<{ title?: string; seed_question?: string }>;
}

interface SerpTaskResult {
  keyword?: string;
  location_code?: number;
  datetime?: string;
  item_types?: string[];
  items?: SerpItem[];
}

/**
 * Block types that matter to a detector, mapped to the names seo.md uses. Any
 * other `item_type` is passed through verbatim — the list of SERP surfaces grows
 * faster than our vocabulary for them, and dropping unknown ones would silently
 * understate what the page-1 experience looks like.
 */
const FEATURE_ALIASES: Record<string, string> = {
  ai_overview: "ai_overview",
  people_also_ask: "people_also_ask",
  featured_snippet: "featured_snippet",
  local_pack: "local_pack",
  video: "video",
  images: "image_pack",
  knowledge_graph: "knowledge_graph",
  shopping: "shopping",
};

function toIsoDate(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  // DataForSEO stamps "2026-07-22 14:05:31 +00:00" — not ISO until the space
  // before the offset goes and the date/time separator becomes a T.
  const normalized = raw.replace(" ", "T").replace(" +", "+").replace(" -", "-");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export class DataForSeoSerpGateway implements SerpGateway {
  async fetchSerp(
    request: SerpRequest,
  ): Promise<Result<SerpFetchResult, SerpGatewayError>> {
    if (!isDataForSeoConfigured()) return err("NOT_CONFIGURED");

    let response: { result: SerpTaskResult[]; cost: number };
    try {
      response = await postTask<SerpTaskResult>(
        "/serp/google/organic/live/advanced",
        {
          keyword: request.query,
          location_code: request.locationCode,
          language_code: request.languageCode,
          device: "desktop",
          os: "windows",
          // Page one is the whole question; asking for more costs more rows.
          depth: Math.max(request.depth, 10),
          // We store the entire SERP, so we want the blocks too, not just links.
          people_also_ask_click_depth: 1,
        },
      );
    } catch (cause) {
      if (cause instanceof DataForSeoNotConfiguredError) return err("NOT_CONFIGURED");
      console.error("[seo] DataForSEO SERP request failed:", cause);
      const status = (cause as { statusCode?: number }).statusCode;
      return err(status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR");
    }

    const [task] = response.result;
    if (!task) return err("NO_RESULTS");

    const items = task.items ?? [];
    const results: SerpOrganicResult[] = [];
    const paaQuestions: string[] = [];
    const features = new Set<string>();

    for (const item of items) {
      const type = item.type ?? "";

      if (type === "organic") {
        const url = item.url ?? "";
        if (url === "") continue;
        results.push({
          // `rank_group` counts organic results only; `rank_absolute` counts
          // every block. Position means "where in the blue links", so it is
          // rank_group — using rank_absolute would report position 7 for the
          // top result on a SERP with a big AI Overview above it.
          position: item.rank_group ?? item.rank_absolute ?? results.length + 1,
          url,
          domain: hostKey(item.domain ?? url),
          title: item.title ?? "",
          description: item.description ?? null,
        });
        continue;
      }

      if (type === "people_also_ask") {
        for (const entry of item.items ?? []) {
          const question = entry.title ?? entry.seed_question;
          if (question) paaQuestions.push(question);
        }
      }

      if (type !== "" && type !== "organic") {
        features.add(FEATURE_ALIASES[type] ?? type);
      }
    }

    // `item_types` is the vendor's own summary of what appeared. Union it in —
    // a block can be reported there without an entry we recognized above.
    for (const type of task.item_types ?? []) {
      if (type !== "organic") features.add(FEATURE_ALIASES[type] ?? type);
    }

    if (results.length === 0) return err("NO_RESULTS");

    const observation: SerpObservation = {
      query: request.query,
      location: String(request.locationCode),
      capturedAt: toIsoDate(task.datetime),
      results: results.sort((a, b) => a.position - b.position),
      features: [...features].sort(),
      paaQuestions,
    };

    return ok({ observation, cost: response.cost });
  }
}

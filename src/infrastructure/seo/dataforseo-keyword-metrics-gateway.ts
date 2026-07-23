import {
  type KeywordMetric,
  type KeywordMetricsGateway,
  type KeywordMetricsRequest,
} from "@/application/ports/keyword-metrics-gateway";
import { isDataForSeoConfigured, postTask } from "./dataforseo-client";

/**
 * DataForSeoKeywordMetricsGateway — the production {@link KeywordMetricsGateway}.
 *
 * Fact family 4 needs three things DataForSEO splits across three endpoints, so
 * this adapter fans out and merges by keyword:
 *
 *   1. `keywords_data/google_ads/search_volume/live` — volume, CPC, competition,
 *      and up to four years of monthly history. ONE task fee for up to 1,000
 *      keywords, which is why the port is batch-shaped.
 *   2. `dataforseo_labs/google/bulk_keyword_difficulty/live` — difficulty.
 *   3. `dataforseo_labs/google/search_intent/live` — intent.
 *
 * All three are best-effort *individually*: a caller asking about a title term
 * should not lose volume because the intent endpoint had a bad minute. A failed
 * sub-call logs and contributes nothing, leaving that field null — which reads
 * as "we don't know", never as zero.
 *
 * seo.md §9 note: `search_volume` accepts `date_from`/`date_to` and returns
 * monthly history retroactively. We never wait a year to learn a demand curve.
 */

interface VolumeRow {
  keyword?: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  monthly_searches?: Array<{
    year?: number;
    month?: number;
    search_volume?: number | null;
  }> | null;
}

interface DifficultyRow {
  items?: Array<{ keyword?: string; keyword_difficulty?: number | null }> | null;
}

interface IntentRow {
  items?: Array<{
    keyword?: string;
    keyword_intent?: { label?: string } | null;
  }> | null;
}

async function safely<T>(
  label: string,
  work: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    console.error(`[seo] DataForSEO ${label} failed:`, cause);
    return fallback;
  }
}

export class DataForSeoKeywordMetricsGateway implements KeywordMetricsGateway {
  async fetchMetrics(request: KeywordMetricsRequest): Promise<KeywordMetric[]> {
    if (!isDataForSeoConfigured()) return [];
    const keywords = [...new Set(request.queries)].filter((q) => q.trim() !== "");
    if (keywords.length === 0) return [];

    const shared = {
      keywords,
      location_code: request.locationCode,
      language_code: request.languageCode,
    };

    const [volumes, difficulties, intents] = await Promise.all([
      safely(
        "search_volume",
        async () =>
          (
            await postTask<VolumeRow>(
              "/keywords_data/google_ads/search_volume/live",
              shared,
            )
          ).result,
        [] as VolumeRow[],
      ),
      safely(
        "bulk_keyword_difficulty",
        async () =>
          (
            await postTask<DifficultyRow>(
              "/dataforseo_labs/google/bulk_keyword_difficulty/live",
              shared,
            )
          ).result,
        [] as DifficultyRow[],
      ),
      safely(
        "search_intent",
        async () =>
          (
            await postTask<IntentRow>(
              "/dataforseo_labs/google/search_intent/live",
              shared,
            )
          ).result,
        [] as IntentRow[],
      ),
    ]);

    const difficultyByKeyword = new Map<string, number | null>();
    for (const row of difficulties) {
      for (const item of row.items ?? []) {
        if (item.keyword) {
          difficultyByKeyword.set(item.keyword, item.keyword_difficulty ?? null);
        }
      }
    }

    const intentByKeyword = new Map<string, string | null>();
    for (const row of intents) {
      for (const item of row.items ?? []) {
        if (item.keyword) {
          intentByKeyword.set(item.keyword, item.keyword_intent?.label ?? null);
        }
      }
    }

    const capturedAt = new Date().toISOString();

    // Drive off the volume rows — that endpoint returns one row per requested
    // keyword. Keywords the vendor has no data for are simply absent, per the
    // port's contract.
    return volumes
      .filter((row): row is VolumeRow & { keyword: string } =>
        Boolean(row.keyword),
      )
      .map((row) => ({
        query: row.keyword,
        searchVolume: row.search_volume ?? null,
        cpc: row.cpc ?? null,
        competition: row.competition ?? null,
        difficulty: difficultyByKeyword.get(row.keyword) ?? null,
        intent: intentByKeyword.get(row.keyword) ?? null,
        monthlySearches: (row.monthly_searches ?? [])
          .filter(
            (m): m is { year: number; month: number; search_volume: number } =>
              typeof m.year === "number" &&
              typeof m.month === "number" &&
              typeof m.search_volume === "number",
          )
          .map((m) => ({
            year: m.year,
            month: m.month,
            searchVolume: m.search_volume,
          }))
          .sort((a, b) => a.year - b.year || a.month - b.month),
        capturedAt,
      }));
  }
}

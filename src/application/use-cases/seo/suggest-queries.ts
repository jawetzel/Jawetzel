import { ok, err, isOk, type Result } from "@/domain/shared/result";
import { extractPageFacts, type PageFacts } from "@/domain/seo/page-facts";
import {
  rankQueryCandidates,
  type QueryCandidate,
} from "@/domain/seo/query-candidates";
import { type PageCrawlGateway } from "@/application/ports/page-crawl-gateway";
import { type LlmGateway } from "@/application/ports/llm-gateway";
import { type KeywordMetricsGateway } from "@/application/ports/keyword-metrics-gateway";

/**
 * SuggestQueries — the "I don't know what my target query should be" helper.
 *
 * Crawl the page → let the LLM draft realistic candidate queries → price each
 * with real DataForSEO demand data → return a ranked shortlist a human picks
 * from. The picked query then feeds the deterministic analyzer.
 *
 * **This is the one LLM-touched use-case in the SEO slice, and it is firewalled
 * from the engine.** The LLM only proposes strings; ranking is a pure function
 * of measured demand (`domain/seo/query-candidates`); nothing the model says
 * ever enters a scored swap. seo.md's "no LLM in the pipeline" is about the
 * measured output — this is upstream input-authoring, so the contract holds.
 *
 * Degrades gracefully: if DataForSEO is unconfigured or down, the candidates
 * come back **ungrounded** (volume/difficulty null) rather than failing — an
 * unpriced list of sensible queries still beats a blank field.
 */

/** Same tier the chat features use. Local so the SEO slice stays self-contained. */
const LLM_MODEL = "gpt-5.4-mini";
/** Hard cap on how many candidates we price and return, whatever the model emits. */
const MAX_CANDIDATES_CEILING = 20;
/** Body text is a strong topical signal; more than this is noise and token cost. */
const PAGE_TEXT_BUDGET = 800;

const SYSTEM_PROMPT = [
  "You suggest Google search queries a page is trying to win.",
  'Return ONLY a JSON object of the form { "queries": ["...", "..."] }.',
  "Each query is a realistic phrase a person would actually type into Google to",
  "find a page like this one. Rules:",
  "- Be specific and use the searcher's words, not the page's marketing copy.",
  "- Vary intent and length: mix a few head terms with longer, more specific ones.",
  "- When a city or region is provided, include location-qualified variants.",
  "- Never use the person's or brand's own name — they already rank for that.",
  "- Lower-case, no punctuation, no quotes inside the strings.",
  "- 8 to 12 queries.",
].join(" ");

export interface SuggestQueriesInput {
  url: string;
  locationCode: number;
  languageCode: string;
  city: string | null;
  maxCandidates: number;
}

export interface SuggestQueriesOutput {
  url: string;
  pageTitle: string | null;
  suggestions: QueryCandidate[];
  sample: {
    /** How many distinct candidates the model proposed. */
    llmCandidates: number;
    /** How many came back with real demand data. */
    grounded: number;
    /** False when DataForSEO returned nothing — the list is LLM-only. */
    metricsAvailable: boolean;
  };
}

export type SuggestQueriesError = "PAGE_UNREACHABLE" | "NO_SUGGESTIONS";

export interface SuggestQueriesDeps {
  crawler: PageCrawlGateway;
  llm: LlmGateway;
  keywords: KeywordMetricsGateway;
}

export interface SuggestQueries {
  execute(
    input: SuggestQueriesInput,
  ): Promise<Result<SuggestQueriesOutput, SuggestQueriesError>>;
}

export function createSuggestQueries(deps: SuggestQueriesDeps): SuggestQueries {
  const { crawler, llm, keywords } = deps;

  return {
    async execute(input) {
      // ---- 1. The page. Same crawler the analyzer uses. ----
      const fetched = await crawler.fetchPage(input.url);
      if (!isOk(fetched)) return err("PAGE_UNREACHABLE");
      const page = extractPageFacts({
        url: fetched.value.finalUrl,
        html: fetched.value.html,
      });

      // ---- 2. LLM drafts candidates from the page's topical signal ----
      const completion = await llm.createChatCompletion({
        model: LLM_MODEL,
        temperature: 0.4,
        maxCompletionTokens: 400,
        responseFormatJson: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(page, input) },
        ],
      });
      const candidates = parseCandidates(
        completion.content,
        Math.min(input.maxCandidates, MAX_CANDIDATES_CEILING),
      );
      if (candidates.length === 0) return err("NO_SUGGESTIONS");

      // ---- 3. Price them with real demand data (one batch = one task fee) ----
      // Best-effort: a missing/failed provider degrades to an unpriced list, it
      // never fails the helper.
      let metrics: Awaited<ReturnType<KeywordMetricsGateway["fetchMetrics"]>> =
        [];
      try {
        metrics = await keywords.fetchMetrics({
          queries: candidates,
          locationCode: input.locationCode,
          languageCode: input.languageCode,
        });
      } catch {
        metrics = [];
      }

      // ---- 4. Rank deterministically from the measured facts ----
      const suggestions = rankQueryCandidates({
        candidates,
        metrics: metrics.map((m) => ({
          query: m.query,
          searchVolume: m.searchVolume,
          difficulty: m.difficulty,
          intent: m.intent,
        })),
      });

      return ok({
        url: page.url,
        pageTitle: page.title,
        suggestions,
        sample: {
          llmCandidates: candidates.length,
          grounded: suggestions.filter((s) => s.grounded).length,
          metricsAvailable: metrics.length > 0,
        },
      });
    },
  };
}

/** The page's topical signal — title, meta, headings, and a slice of body text. */
function buildUserPrompt(page: PageFacts, input: SuggestQueriesInput): string {
  const headings = page.headings.map((h) => h.text).filter(Boolean);
  const lines = [
    `URL: ${page.url}`,
    `Title: ${page.title ?? "(none)"}`,
    `Meta description: ${page.metaDescription ?? "(none)"}`,
    `H1: ${page.h1.join(" | ") || "(none)"}`,
    `Headings: ${headings.slice(0, 20).join(" | ") || "(none)"}`,
  ];
  if (input.city) lines.push(`City / region: ${input.city}`);
  const text = page.text.slice(0, PAGE_TEXT_BUDGET);
  if (text) lines.push(`Body excerpt: ${text}`);
  return lines.join("\n");
}

/** Parse `{ queries: [...] }` (or a bare array), tolerating a chatty model. */
function parseCandidates(content: string | null, max: number): string[] {
  if (!content) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.queries)
      ? parsed.queries
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const query = item.trim();
    const key = query.toLowerCase();
    if (query === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length >= max) break;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

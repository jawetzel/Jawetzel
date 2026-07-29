import { ok, err, isOk, type Result } from "@/domain/shared/result";
import { extractPageFacts, type PageFacts } from "@/domain/seo/page-facts";
import { type GapKeyword } from "@/domain/seo/gap-pile";
import {
  pageKey,
  preRoute,
  reconcileVerdicts,
  type RawVerdict,
  type Routing,
} from "@/domain/seo/routing";
import { type PageCrawlGateway } from "@/application/ports/page-crawl-gateway";
import { type LlmGateway } from "@/application/ports/llm-gateway";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";
import { type SeoRoutingRepository } from "@/application/ports/seo-routing-repository";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * RoutePageKeywords — layer 4a. Sort the pile against **one page's content**.
 *
 * This is the first and only place a model touches the pipeline, and the line
 * it sits on is precise: **the model classifies, it never produces a number.**
 * Every score, position, volume, and difficulty upstream stays deterministic and
 * diffable; what arrives here is a topical judgment — "is this keyword about the
 * same thing as this page?" — which frequency analysis does badly and a model
 * does well.
 *
 * `improve` needs no judgment at all: the vendor already told us which of our
 * URLs holds the ranking, so if it is this page the answer is measured, not
 * guessed. Only `enrich` vs `create` is asked.
 *
 * Verdicts persist per `(tag, pageUrl, keyword)` because the backlog — keywords
 * no page ever claimed — is set math over them. A human override survives
 * re-routing; the model may change its mind, a person's correction outranks it.
 */

/** Same tier the other SEO helper uses, so the slice stays self-contained. */
const LLM_MODEL = "gpt-5.4-mini";
/** Classification, not composition — no reason to sample. */
const TEMPERATURE = 0;
/** Keywords per model call. Larger batches degrade recall on the tail. */
const BATCH_SIZE = 40;
/** Topical signal beyond this is token cost, not information. */
const PAGE_TEXT_BUDGET = 1500;

const SYSTEM_PROMPT = [
  "You sort search keywords against ONE web page.",
  'Return ONLY JSON: { "routes": [ { "keyword": "...", "verdict": "enrich" | "create", "why": "..." } ] }.',
  "For each keyword decide, judging ONLY by subject matter:",
  '- "enrich" — the keyword is on-topic for THIS page. A reader searching it would',
  "  be well served here, even if the page never uses those exact words.",
  '- "create" — the keyword is off-topic for THIS page. It may suit the site, but',
  "  it belongs on a different page.",
  "Judge the topic, not the wording: a page titled 'Winter Garden Prep' is on-topic",
  "for 'cold hardy trees' even though it shares no words with it.",
  "Be strict about 'enrich'. A page cannot be about everything, and a keyword that",
  "only loosely relates belongs on its own page.",
  'Return every keyword you were given, exactly as spelled. "why" is one short clause.',
].join(" ");

export interface RoutePageKeywordsInput {
  tag: string;
  pageUrl: string;
}

export interface RoutePageKeywordsOutput {
  tag: string;
  pageUrl: string;
  pageTitle: string | null;
  counts: { improve: number; enrich: number; create: number };
  /** `improve` rows belonging to another of our pages, excluded from this run. */
  ownedElsewhere: number;
  /** Verdicts left untouched because a human had corrected them. */
  preserved: number;
  routings: Routing[];
}

export type RoutePageKeywordsError =
  | "TAG_NOT_FOUND"
  | "PAGE_UNREACHABLE"
  | "NOTHING_ACCEPTED"
  | "ROUTING_FAILED";

export interface RoutePageKeywords {
  execute(
    input: RoutePageKeywordsInput,
  ): Promise<Result<RoutePageKeywordsOutput, RoutePageKeywordsError>>;
}

export function createRoutePageKeywords(deps: {
  workspace: SeoWorkspaceRepository;
  gaps: SeoGapRepository;
  routings: SeoRoutingRepository;
  crawler: PageCrawlGateway;
  llm: LlmGateway;
  now?: () => Date;
}): RoutePageKeywords {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const tag = await deps.workspace.findTag(input.tag);
      if (!tag) return err("TAG_NOT_FOUND");

      const accepted = await deps.gaps.list({
        tag: tag.tag,
        status: "accepted",
        limit: 500,
      });
      if (accepted.length === 0) return err("NOTHING_ACCEPTED");

      // ---- 1. The page. Same crawler the analyzer uses. ----
      const fetched = await deps.crawler.fetchPage(input.pageUrl);
      if (!isOk(fetched)) return err("PAGE_UNREACHABLE");
      const page = extractPageFacts({
        url: fetched.value.finalUrl,
        html: fetched.value.html,
      });

      const url = pageKey(page.url);
      const routedAt = now().toISOString();

      // ---- 2. Decide everything decidable without a model ----
      const split = preRoute({ pageUrl: url, rows: accepted });

      const routings: Routing[] = split.decided.map((d) => ({
        tag: tag.tag,
        pageUrl: url,
        keyword: d.keyword,
        verdict: d.verdict,
        rationale: null,
        overridden: false,
        routedAt,
      }));

      // ---- 3. Ask only the genuine question: enrich or create ----
      let modelFailed = false;
      for (const batch of chunk(split.needsJudgment, BATCH_SIZE)) {
        const asked = batch.map((row) => row.keyword);
        let returned: RawVerdict[] = [];
        try {
          const completion = await deps.llm.createChatCompletion({
            model: LLM_MODEL,
            temperature: TEMPERATURE,
            maxCompletionTokens: 100 + asked.length * 40,
            responseFormatJson: true,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: buildPrompt(page, asked) },
            ],
          });
          returned = parseRoutes(completion.content);
        } catch (cause) {
          // Log once, here — the batch degrades to the conservative default
          // rather than failing a run that may already have real verdicts.
          console.error("[seo] routing batch failed:", cause);
          modelFailed = true;
        }

        // Anything the model skipped, invented, or mislabelled falls back to
        // `create`: parking a keyword in the backlog is recoverable, asserting
        // a page should cover something nobody judged is not.
        for (const decided of reconcileVerdicts({ asked, returned })) {
          routings.push({
            tag: tag.tag,
            pageUrl: url,
            keyword: decided.keyword,
            verdict: decided.verdict,
            rationale: decided.rationale,
            overridden: false,
            routedAt,
          });
        }
      }

      if (modelFailed && routings.every((r) => r.verdict === "create")) {
        // Every judged keyword defaulted and nothing was measured — that is a
        // failed routing, not a page with no on-topic keywords.
        return err("ROUTING_FAILED");
      }

      const saved = await deps.routings.saveAll({
        tag: tag.tag,
        pageUrl: url,
        routings,
      });

      // Re-read so the response reflects any override that outranked this run.
      const stored = await deps.routings.list({
        tag: tag.tag,
        pageUrl: url,
        limit: 1000,
      });

      return ok({
        tag: tag.tag,
        pageUrl: url,
        pageTitle: page.title,
        counts: {
          improve: stored.filter((r) => r.verdict === "improve").length,
          enrich: stored.filter((r) => r.verdict === "enrich").length,
          create: stored.filter((r) => r.verdict === "create").length,
        },
        ownedElsewhere: split.ownedElsewhere,
        preserved: saved.preserved,
        routings: stored,
      });
    },
  };
}

/** The page's topical signal, plus the keywords to sort against it. */
function buildPrompt(page: PageFacts, keywords: string[]): string {
  const headings = page.headings.map((h) => h.text).filter(Boolean);
  return [
    "PAGE",
    `URL: ${page.url}`,
    `Title: ${page.title ?? "(none)"}`,
    `Meta description: ${page.metaDescription ?? "(none)"}`,
    `H1: ${page.h1.join(" | ") || "(none)"}`,
    `Headings: ${headings.slice(0, 30).join(" | ") || "(none)"}`,
    `Body excerpt: ${page.text.slice(0, PAGE_TEXT_BUDGET) || "(none)"}`,
    "",
    "KEYWORDS",
    ...keywords.map((k) => `- ${k}`),
  ].join("\n");
}

/** Parse `{ routes: [...] }`, tolerating a bare array from a chatty model. */
function parseRoutes(content: string | null): RawVerdict[] {
  if (!content) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.routes)
      ? parsed.routes
      : [];
  return raw.filter(isRecord).map((entry) => ({
    keyword: typeof entry.keyword === "string" ? entry.keyword : "",
    verdict: typeof entry.verdict === "string" ? entry.verdict : "",
    why: typeof entry.why === "string" ? entry.why : null,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

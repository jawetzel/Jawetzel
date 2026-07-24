import { ok, err, isOk, type Result } from "@/domain/shared/result";
import { extractPageFacts } from "@/domain/seo/page-facts";
import { type SerpObservation } from "@/domain/seo/serp-facts";
import { hostKey, sameProperty } from "@/domain/seo/property-id";
import {
  selectCompetitorQueries,
  type CompetitorQuerySuggestion,
  type RankedKeywordsObservation,
} from "@/domain/seo/competitor-queries";
import { type PageCrawlGateway } from "@/application/ports/page-crawl-gateway";
import { type SerpGateway } from "@/application/ports/serp-gateway";
import {
  type RankedKeywordsGateway,
  type RankedKeywordsGatewayError,
} from "@/application/ports/ranked-keywords-gateway";
import { type SeoCorpusRepository } from "@/application/ports/seo-corpus-repository";

/**
 * DiscoverCompetitorQueries — "what should I analyze next?", the loop step of
 * the Discover flow (seo.md Part 1, steps 4–5, scoped to one SERP's worth of
 * competitors rather than a property-level intake).
 *
 * Given a page and the query it was just analyzed for, look at who occupies
 * that SERP, pull what those domains rank for (corpus-first, vendor on a
 * miss), and return the ranked, deduped, on-topic queries they win that the
 * caller hasn't analyzed yet. The caller feeds the top of the list back into
 * `AnalyzePage` — that iteration is the whole point.
 *
 * **There is no LLM anywhere in this use-case.** Selection is a pure function
 * of vendor-observed positions/demand and token overlap with the caller's own
 * page (`domain/seo/competitor-queries`). The one LLM touch in Discover is
 * upstream, drafting the seed query in `SuggestQueries`.
 */

export interface DiscoverCompetitorQueriesInput {
  url: string;
  /** The query whose SERP defines "the competition" — usually just analyzed. */
  targetQuery: string;
  locationCode: number;
  languageCode: string;
  /** How many distinct SERP domains to pull rankings for. */
  maxCompetitors: number;
  maxSuggestions: number;
  /** Queries already analyzed this session — never re-suggested. */
  excludeQueries: string[];
  /** Reuse a stored SERP this fresh instead of re-observing. */
  maxSnapshotAgeDays: number;
}

/** One SERP domain we tried to pull rankings for, and how that went. */
export interface CompetitorSource {
  domain: string;
  /** The domain's best position on the target query's SERP. */
  serpPosition: number;
  /** Ranked-keyword rows we hold for it; 0 when the pull failed. */
  keywordsSampled: number;
  /** The vendor's full keyword count for the domain, when reported. */
  totalKeywords: number | null;
  fromCorpus: boolean;
  failed: boolean;
}

export interface DiscoverCompetitorQueriesOutput {
  url: string;
  targetQuery: string;
  location: string;
  analyzedAt: string;
  /** Best next target queries, highest leverage first. */
  suggestions: CompetitorQuerySuggestion[];
  competitors: CompetitorSource[];
  sample: {
    serpCapturedAt: string;
    serpFromCorpus: boolean;
    competitorsRequested: number;
    competitorsWithData: number;
  };
}

export type DiscoverCompetitorQueriesError =
  | "PAGE_UNREACHABLE"
  | "SERP_UNAVAILABLE"
  | "SERP_NOT_CONFIGURED"
  /** SERP came from the corpus but the ranked-keywords provider is unconfigured. */
  | "RANKED_KEYWORDS_NOT_CONFIGURED"
  /** Every competitor pull failed (or the SERP held nobody but the caller). */
  | "NO_COMPETITOR_DATA";

export interface DiscoverCompetitorQueriesDeps {
  crawler: PageCrawlGateway;
  serp: SerpGateway;
  rankedKeywords: RankedKeywordsGateway;
  corpus: SeoCorpusRepository;
  /** Injected so freshness windows and `analyzedAt` are testable. */
  now?: () => Date;
}

export interface DiscoverCompetitorQueries {
  execute(
    input: DiscoverCompetitorQueriesInput,
  ): Promise<
    Result<DiscoverCompetitorQueriesOutput, DiscoverCompetitorQueriesError>
  >;
}

/** Page one is who the caller is actually losing to. */
const SERP_DEPTH = 10;
/** Rankings are slow-moving — seo.md Part 3 refreshes them quarterly. */
const RANKED_KEYWORDS_MAX_AGE_DAYS = 90;
/** Rows per domain. Volume-ordered at the vendor, so the cap keeps the best. */
const RANKED_KEYWORDS_LIMIT = 100;

interface PullOutcome {
  domain: string;
  serpPosition: number;
  observation: RankedKeywordsObservation | null;
  fromCorpus: boolean;
  error: RankedKeywordsGatewayError | null;
}

export function createDiscoverCompetitorQueries(
  deps: DiscoverCompetitorQueriesDeps,
): DiscoverCompetitorQueries {
  const { crawler, serp: serpGateway, rankedKeywords, corpus } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const analyzedAt = now().toISOString();
      const location = String(input.locationCode);

      // ---- 1. The caller's page — the relevance yardstick for selection ----
      const fetched = await crawler.fetchPage(input.url);
      if (!isOk(fetched)) return err("PAGE_UNREACHABLE");
      const page = extractPageFacts({
        url: fetched.value.finalUrl,
        html: fetched.value.html,
      });

      // ---- 2. The SERP that defines the competition: corpus first ----
      const stored = await corpus.findRecentSnapshot({
        query: input.targetQuery,
        location,
        maxAgeDays: input.maxSnapshotAgeDays,
      });

      let observation: SerpObservation;
      let serpFromCorpus = false;
      if (stored) {
        observation = stored;
        serpFromCorpus = true;
      } else {
        const live = await serpGateway.fetchSerp({
          query: input.targetQuery,
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          depth: SERP_DEPTH,
        });
        if (!isOk(live)) {
          return err(
            live.error === "NOT_CONFIGURED"
              ? "SERP_NOT_CONFIGURED"
              : "SERP_UNAVAILABLE",
          );
        }
        observation = live.value.observation;
        // Same flywheel write the analyzer makes — a Discover call that had to
        // observe a SERP leaves it behind for the next caller.
        await corpus.saveSnapshot(observation);
      }

      // ---- 3. Distinct competitor domains, best SERP position first ----
      const byDomain = new Map<string, number>();
      for (const result of [...observation.results].sort(
        (a, b) => a.position - b.position,
      )) {
        const domain = hostKey(result.domain);
        if (domain === "" || sameProperty(domain, page.url)) continue;
        if (!byDomain.has(domain)) byDomain.set(domain, result.position);
      }
      const competitors = [...byDomain.entries()].slice(
        0,
        input.maxCompetitors,
      );
      if (competitors.length === 0) return err("NO_COMPETITOR_DATA");

      // ---- 4. What each of them ranks for: corpus first, vendor on a miss ----
      // Failures stay per-domain, mirroring the analyzer's crawl failures: one
      // blocked pull shrinks the sample and is reported, never fatal on its own.
      const outcomes: PullOutcome[] = await Promise.all(
        competitors.map(async ([domain, serpPosition]) => {
          const fresh = await corpus.findRecentRankedKeywords({
            target: domain,
            location,
            maxAgeDays: RANKED_KEYWORDS_MAX_AGE_DAYS,
          });
          if (fresh) {
            return {
              domain,
              serpPosition,
              observation: fresh,
              fromCorpus: true,
              error: null,
            };
          }
          const pulled = await rankedKeywords.fetchRankedKeywords({
            target: domain,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            limit: RANKED_KEYWORDS_LIMIT,
          });
          if (!isOk(pulled)) {
            return {
              domain,
              serpPosition,
              observation: null,
              fromCorpus: false,
              error: pulled.error,
            };
          }
          await corpus.saveRankedKeywords(pulled.value.observation);
          return {
            domain,
            serpPosition,
            observation: pulled.value.observation,
            fromCorpus: false,
            error: null,
          };
        }),
      );

      const observations = outcomes
        .map((o) => o.observation)
        .filter((o): o is RankedKeywordsObservation => o !== null);
      if (observations.length === 0) {
        return err(
          outcomes.every((o) => o.error === "NOT_CONFIGURED")
            ? "RANKED_KEYWORDS_NOT_CONFIGURED"
            : "NO_COMPETITOR_DATA",
        );
      }

      // ---- 5. Deterministic selection — the target query is never re-suggested ----
      const suggestions = selectCompetitorQueries({
        observations,
        page,
        excludeQueries: [...input.excludeQueries, input.targetQuery],
        maxSuggestions: input.maxSuggestions,
      });

      return ok({
        url: page.url,
        targetQuery: input.targetQuery,
        location,
        analyzedAt,
        suggestions,
        competitors: outcomes.map((o) => ({
          domain: o.domain,
          serpPosition: o.serpPosition,
          keywordsSampled: o.observation?.rows.length ?? 0,
          totalKeywords: o.observation?.totalCount ?? null,
          fromCorpus: o.fromCorpus,
          failed: o.error !== null,
        })),
        sample: {
          serpCapturedAt: observation.capturedAt,
          serpFromCorpus,
          competitorsRequested: competitors.length,
          competitorsWithData: observations.length,
        },
      });
    },
  };
}

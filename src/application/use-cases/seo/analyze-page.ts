import { ok, err, isOk, type Result } from "@/domain/shared/result";
import { extractPageFacts, type PageFacts } from "@/domain/seo/page-facts";
import {
  computeSerpFacts,
  type CompetitorPage,
  type SerpFacts,
  type SerpObservation,
} from "@/domain/seo/serp-facts";
import {
  computeDeltaFacts,
  isRecommended,
  type DeltaFacts,
} from "@/domain/seo/delta-facts";
import { buildSwaps, type Swap } from "@/domain/seo/swaps";
import {
  computeHistoryFacts,
  type HistoryFacts,
} from "@/domain/seo/history-facts";
import { propertyIdOf, sameProperty } from "@/domain/seo/property-id";
import { type PageCrawlGateway } from "@/application/ports/page-crawl-gateway";
import { type SerpGateway } from "@/application/ports/serp-gateway";
import {
  type KeywordMetric,
  type KeywordMetricsGateway,
} from "@/application/ports/keyword-metrics-gateway";
import { type SeoCorpusRepository } from "@/application/ports/seo-corpus-repository";
import {
  type AnalysisSample,
  type SeoAnalysisRepository,
} from "@/application/ports/seo-analysis-repository";

/**
 * AnalyzePage — the advisory engine's one use-case (seo.md Part 4b).
 *
 * It works with **zero history**: a business that launched last month has no
 * Search Console data, and a full work order needs only four inputs, all
 * available at first contact — the caller's page (our crawl), the SERP for the
 * target query, the top-10 competitor pages (crawl them too), and per-vertical
 * config. History makes the answer better and lets us prove it worked; it is
 * never a precondition for value.
 *
 * Orchestration only. Every measurement is a pure domain function, every I/O is
 * a port, and the whole thing is unit-tested with fixture SERPs and fixture
 * pages — no network, no database.
 *
 * **There is no LLM anywhere in this pipeline.** The tool consumes, records, and
 * emits measured facts; wording is the caller's job. That constraint is what
 * makes every output a pure function of stored inputs — testable with exact
 * assertions, diffable across runs, no hallucination surface.
 */

/**
 * Bumped whenever a detector or score changes meaning. Stamped on every
 * response (and every `page_analysis` row a consumer stores) so runs stay
 * comparable as the formulas improve — seo.md Part 4's `formulaVersion`.
 */
export const FORMULA_VERSION = "1.0.0";

/** Optional response sections. Nothing here appears by default. */
export type AnalyzeInclude =
  | "provenance"
  | "history"
  | "serp"
  | "facts"
  | "keywords";

export interface AnalyzePageInput {
  url: string;
  targetQuery: string;
  locationCode: number;
  languageCode: string;
  /** The vertical's fact types — seo.md §2's load-bearing config field. */
  entitySchema: string[];
  urgencyTerms: string[];
  city: string | null;
  /** Share of competitors that must use a feature before we recommend it. */
  minShare: number;
  /** Reuse a stored SERP this fresh instead of re-observing. */
  maxSnapshotAgeDays: number;
  include: AnalyzeInclude[];
}

export interface AnalyzePageOutput {
  url: string;
  query: string;
  location: string;
  analyzedAt: string;
  formulaVersion: string;
  swaps: Swap[];
  /** Echoed so a consumer who disagrees can re-derive from the raw facts. */
  thresholds: { minShare: number; maxSnapshotAgeDays: number };
  sample: AnalysisSample;
  history?: HistoryFacts;
  serp?: SerpFacts;
  facts?: { page: PageFactsView; delta: DeltaFacts };
  keywords?: KeywordMetric[];
}

/** `PageFacts` minus the Set-typed internals, which don't serialize to JSON. */
export interface PageFactsView {
  url: string;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1: string[];
  headings: Array<{ level: number; text: string }>;
  wordCount: number;
  schemaTypes: string[];
  canonical: string | null;
  noindex: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinksOut: number;
  externalLinksOut: number;
  telLinks: string[];
  phoneInHeader: boolean;
  contentHash: string;
}

export type AnalyzePageError =
  | "PAGE_UNREACHABLE"
  | "SERP_UNAVAILABLE"
  | "SERP_NOT_CONFIGURED";

export interface AnalyzePageDeps {
  crawler: PageCrawlGateway;
  serp: SerpGateway;
  keywords: KeywordMetricsGateway;
  corpus: SeoCorpusRepository;
  /** Derived run history — seo.md Part 4's `page_analysis`. Best-effort writes. */
  analyses: SeoAnalysisRepository;
  /** Injected so freshness windows and `analyzedAt` are testable. */
  now?: () => Date;
}

export interface AnalyzePage {
  execute(
    input: AnalyzePageInput,
  ): Promise<Result<AnalyzePageOutput, AnalyzePageError>>;
}

/** How many organic results we fetch bodies for. Page one is the whole question. */
const COMPETITOR_CRAWL_DEPTH = 10;
/** Window for the Part 4c history facts. */
const HISTORY_WINDOW_DAYS = 90;
/** Keyword metrics are slow-moving — seo.md refreshes them quarterly. */
const KEYWORD_METRIC_MAX_AGE_DAYS = 90;

export function createAnalyzePage(deps: AnalyzePageDeps): AnalyzePage {
  const { crawler, serp: serpGateway, keywords, corpus, analyses } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const analyzedAt = now().toISOString();
      const location = String(input.locationCode);

      // ---- 1. The caller's page. Nothing else is computable without it. ----
      const fetched = await crawler.fetchPage(input.url);
      if (!isOk(fetched)) return err("PAGE_UNREACHABLE");
      const page = extractPageFacts({
        url: fetched.value.finalUrl,
        html: fetched.value.html,
      });

      // ---- 2. The SERP: corpus first, vendor on a miss ----
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
          depth: COMPETITOR_CRAWL_DEPTH,
        });
        if (!isOk(live)) {
          return err(
            live.error === "NOT_CONFIGURED"
              ? "SERP_NOT_CONFIGURED"
              : "SERP_UNAVAILABLE",
          );
        }
        observation = live.value.observation;
        // Every consumer request causes us to pull and store a SERP. This write
        // is the flywheel: more queries observed -> better volatility and
        // trajectory facts for every caller (seo.md Part 4c).
        await corpus.saveSnapshot(observation);
      }

      // ---- 3. Competitor bodies ----
      const competitorUrls = observation.results
        .filter((r) => !sameProperty(r.domain, page.url))
        .sort((a, b) => a.position - b.position)
        .slice(0, COMPETITOR_CRAWL_DEPTH)
        .map((r) => ({ position: r.position, url: r.url }));

      const crawled = await crawler.fetchPages(competitorUrls.map((c) => c.url));
      const competitorPages: CompetitorPage[] = [];
      let crawlFailures = 0;
      crawled.forEach((result, index) => {
        if (!isOk(result)) {
          // A competitor that blocks us shrinks the crawled sample and is
          // reported as such. It never fails the request — and it never
          // silently inflates a denominator either.
          crawlFailures += 1;
          return;
        }
        competitorPages.push({
          position: competitorUrls[index].position,
          url: result.value.finalUrl,
          facts: extractPageFacts({
            url: result.value.finalUrl,
            html: result.value.html,
          }),
        });
      });

      // ---- 4. The pure pipeline: families 2 and 3, then swaps ----
      const patternConfig = {
        urgencyTerms: input.urgencyTerms,
        city: input.city,
      };
      const serpFacts = computeSerpFacts({
        observation,
        competitorPages,
        ourDomain: page.url,
        config: patternConfig,
      });
      const deltaFacts = computeDeltaFacts({
        page,
        serp: serpFacts,
        config: {
          ...patternConfig,
          minShare: input.minShare,
          entitySchema: input.entitySchema,
        },
      });
      const swaps = buildSwaps({
        page,
        serp: serpFacts,
        delta: deltaFacts,
        minShare: input.minShare,
        includeProvenance: input.include.includes("provenance"),
      });

      // ---- 5. Persist the page snapshot, only on change ----
      // "The dataset everyone skips, and what closes the loop. Without a record
      // of what the page said in March, we can never answer 'did the rewrite
      // work?'"
      const previousHash = await corpus.latestPageContentHash(page.url);
      if (previousHash !== page.contentHash) {
        await corpus.savePageSnapshot({
          propertyId: propertyIdOf(page.url),
          url: page.url,
          capturedAt: analyzedAt,
          contentHash: page.contentHash,
          title: page.title,
          metaDescription: page.metaDescription,
          h1: page.h1,
          headings: page.headings,
          wordCount: page.wordCount,
          schemaTypes: page.schemaTypes,
          canonical: page.canonical,
          statusCode: fetched.value.statusCode,
          internalLinksOut: page.internalLinksOut,
          imagesTotal: page.imagesTotal,
          imagesMissingAlt: page.imagesMissingAlt,
        });
      }

      // ---- 6. Keyword metrics (fact family 4) ----
      const keywordMetrics = await resolveKeywordMetrics({
        input,
        location,
        serpFacts,
        keywords,
        corpus,
      });

      const output: AnalyzePageOutput = {
        url: page.url,
        query: input.targetQuery,
        location,
        analyzedAt,
        formulaVersion: FORMULA_VERSION,
        swaps,
        thresholds: {
          minShare: input.minShare,
          maxSnapshotAgeDays: input.maxSnapshotAgeDays,
        },
        sample: {
          competitors: serpFacts.competitorCount,
          crawled: serpFacts.crawledCount,
          crawlFailures,
          serpCapturedAt: observation.capturedAt,
          serpFromCorpus,
          ourPosition: serpFacts.ourPosition,
          features: serpFacts.features,
        },
      };

      if (input.include.includes("history")) {
        const since = new Date(
          now().getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const snapshots = await corpus.findSnapshots({
          query: input.targetQuery,
          location,
          since,
        });
        output.history = computeHistoryFacts({
          snapshots,
          currentTitleTerms: serpFacts.titleTerms
            .filter((t) => isRecommended(t, input.minShare))
            .map((t) => t.term),
        });
      }
      if (input.include.includes("serp")) output.serp = serpFacts;
      if (input.include.includes("facts")) {
        output.facts = { page: toPageFactsView(page), delta: deltaFacts };
      }
      if (input.include.includes("keywords")) output.keywords = keywordMetrics;

      // ---- 7. Persist the run to the derived history (seo.md `page_analysis`) ----
      // Only the durable core — swaps and the sample — never the request-specific
      // include sections. This history is regenerable from the raw corpus, so a
      // write failure must NOT fail an analysis the caller already has in hand.
      try {
        await analyses.save({
          propertyId: propertyIdOf(page.url),
          url: page.url,
          query: input.targetQuery,
          location,
          runAt: analyzedAt,
          formulaVersion: FORMULA_VERSION,
          swaps,
          sample: output.sample,
        });
      } catch {
        // Derived and disposable — swallow so a completed run still returns.
      }

      return ok(output);
    },
  };
}

/**
 * Corpus first, vendor on a miss, then write back.
 *
 * The vendor call batches the target query together with the recommended title
 * terms. DataForSEO bills per *task* plus per row and the task fee dominates, so
 * asking about 20 queries costs what asking about 1 does — the extra rows land
 * in the corpus for free and make the next caller's answer better. Only the
 * target query is ever returned.
 */
async function resolveKeywordMetrics(args: {
  input: AnalyzePageInput;
  location: string;
  serpFacts: SerpFacts;
  keywords: KeywordMetricsGateway;
  corpus: SeoCorpusRepository;
}): Promise<KeywordMetric[]> {
  const { input, location, serpFacts, keywords, corpus } = args;

  const stored = await corpus.findKeywordMetrics({
    queries: [input.targetQuery],
    location,
    maxAgeDays: KEYWORD_METRIC_MAX_AGE_DAYS,
  });
  if (stored.length > 0) return stored;

  const batch = [
    input.targetQuery,
    ...serpFacts.titleTerms
      .filter((t) => isRecommended(t, input.minShare))
      .map((t) => t.term),
  ];
  const deduped = [...new Set(batch)].slice(0, 20);

  const fetchedMetrics = await keywords.fetchMetrics({
    queries: deduped,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  if (fetchedMetrics.length > 0) {
    await corpus.upsertKeywordMetrics({ location, metrics: fetchedMetrics });
  }
  return fetchedMetrics.filter((m) => m.query === input.targetQuery);
}

/** Entity → DTO mapping at the edge of the use-case, explicit and named. */
function toPageFactsView(page: PageFacts): PageFactsView {
  return {
    url: page.url,
    title: page.title,
    titleLength: page.titleLength,
    metaDescription: page.metaDescription,
    metaDescriptionLength: page.metaDescriptionLength,
    h1: page.h1,
    headings: page.headings,
    wordCount: page.wordCount,
    schemaTypes: page.schemaTypes,
    canonical: page.canonical,
    noindex: page.noindex,
    imagesTotal: page.imagesTotal,
    imagesMissingAlt: page.imagesMissingAlt,
    internalLinksOut: page.internalLinksOut,
    externalLinksOut: page.externalLinksOut,
    telLinks: page.telLinks,
    phoneInHeader: page.phoneInHeader,
    contentHash: page.contentHash,
  };
}

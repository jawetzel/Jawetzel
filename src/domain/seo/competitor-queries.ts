import { contentWords, normalize, tokenize } from "./text";
import { demandScore, winnabilityScore } from "./query-candidates";

/**
 * Competitor-derived query selection — the deterministic core of the Discover
 * flow (seo.md Part 1, step 5: "What do they rank for that I don't?").
 *
 * Discover's only LLM touch is upstream, authoring the *seed* query
 * (suggest-queries). Everything here is a pure function of measured facts:
 * vendor-observed positions and demand, plus token overlap with the caller's
 * own page. Nothing a model said ever decides which query gets analyzed next,
 * so the advisory engine's "no LLM in the pipeline" contract holds.
 */

/** One keyword a target domain ranks for — a row of `seo_ranked_keywords`. */
export interface RankedKeywordRow {
  keyword: string;
  /** Organic position ("where in the blue links") of the target's best page. */
  position: number;
  /** The target's URL that ranks, when the vendor reports it. */
  url: string | null;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
}

/** One observation of a domain's rankings — stored per `(target, location)`. */
export interface RankedKeywordsObservation {
  /** Host key of the observed domain. */
  target: string;
  location: string;
  capturedAt: string;
  /** The vendor's full keyword count for the target, beyond the rows fetched. */
  totalCount: number | null;
  rows: RankedKeywordRow[];
}

/**
 * The page fields relevance is measured against. `PageFacts` satisfies this
 * structurally; tests can hand in a literal.
 */
export interface PageTopicSource {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  headings: Array<{ text: string }>;
  text: string;
}

export interface CompetitorQuerySuggestion {
  query: string;
  /** 0–100 heuristic: demand + winnability + competitor breadth. */
  score: number;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
  /** How many sampled competitors rank top-10 for it. */
  competitorCount: number;
  /** The best position any of them holds. */
  bestPosition: number;
  /** The competitors that rank, best position first. */
  domains: string[];
}

/** A competitor "does well" on a query when it holds a page-one position. */
const TOP_POSITION_MAX = 10;
/**
 * Share of a query's content words that must appear on the caller's page for
 * the query to count as on-topic. Half keeps adjacent opportunities ("cold
 * hardy shrubs" against a cold-hardy-trees page) while dropping the rest of a
 * competitor's catalog ("lawn mower repair" matching only on "repair").
 */
const MIN_TOKEN_OVERLAP = 0.5;

/**
 * Same explicit-heuristic contract as `query-candidates`: every operand is
 * returned so a human can overrule the ordering. Breadth is the new term —
 * a query that several competitors win is the vertical's bread and butter,
 * not one site's fluke.
 */
const WEIGHT_DEMAND = 0.45;
const WEIGHT_WINNABILITY = 0.3;
const WEIGHT_BREADTH = 0.25;

/**
 * A competitor's own name, as one glued token ("fast-growing-trees.com" →
 * "fastgrowingtrees"). Used to drop navigational queries for *that* target
 * ("fastgrowingtrees coupon") without touching generic phrases that happen to
 * spell the brand out in separate words ("fast growing trees").
 */
function brandToken(target: string): string {
  const label = target.split(".")[0] ?? "";
  return normalize(label).replace(/ /g, "");
}

function isBrandQuery(keyword: string, brand: string): boolean {
  return brand !== "" && tokenize(keyword).includes(brand);
}

interface QueryGroup {
  query: string;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
  bestPosition: number;
  /** target → its best position for this query. */
  positions: Map<string, number>;
}

/**
 * Pool every competitor's page-one keywords, drop what is navigational,
 * off-topic, or already analyzed, and rank what remains as next target-query
 * candidates. Pure; deterministic; sorted stably so identical inputs always
 * serialize identically.
 */
export function selectCompetitorQueries(input: {
  observations: RankedKeywordsObservation[];
  page: PageTopicSource;
  /** Queries already analyzed (or otherwise spoken for) — never re-suggested. */
  excludeQueries: string[];
  maxSuggestions: number;
}): CompetitorQuerySuggestion[] {
  const { observations, page, maxSuggestions } = input;
  if (observations.length === 0 || maxSuggestions <= 0) return [];

  const pageTokens = new Set<string>([
    ...contentWords(page.title ?? ""),
    ...contentWords(page.metaDescription ?? ""),
    ...page.h1.flatMap((h) => contentWords(h)),
    ...page.headings.flatMap((h) => contentWords(h.text)),
    ...contentWords(page.text),
  ]);
  const excluded = new Set(input.excludeQueries.map((q) => normalize(q)));

  const groups = new Map<string, QueryGroup>();
  for (const observation of observations) {
    const brand = brandToken(observation.target);
    for (const row of observation.rows) {
      if (row.position > TOP_POSITION_MAX) continue;
      if (isBrandQuery(row.keyword, brand)) continue;
      const key = normalize(row.keyword);
      if (key === "" || excluded.has(key)) continue;

      let group = groups.get(key);
      if (!group) {
        group = {
          query: key,
          searchVolume: null,
          difficulty: null,
          intent: null,
          bestPosition: row.position,
          positions: new Map(),
        };
        groups.set(key, group);
      }
      group.searchVolume = group.searchVolume ?? row.searchVolume;
      group.difficulty = group.difficulty ?? row.difficulty;
      group.intent = group.intent ?? row.intent;
      group.bestPosition = Math.min(group.bestPosition, row.position);
      const known = group.positions.get(observation.target);
      if (known === undefined || row.position < known) {
        group.positions.set(observation.target, row.position);
      }
    }
  }

  const suggestions: CompetitorQuerySuggestion[] = [];
  for (const group of groups.values()) {
    const queryTokens = contentWords(group.query);
    if (queryTokens.length === 0) continue;
    const overlap =
      queryTokens.filter((t) => pageTokens.has(t)).length / queryTokens.length;
    if (overlap < MIN_TOKEN_OVERLAP) continue;

    const breadth = Math.min(1, group.positions.size / observations.length);
    const score = Math.round(
      100 *
        (WEIGHT_DEMAND * demandScore(group.searchVolume) +
          WEIGHT_WINNABILITY * winnabilityScore(group.difficulty) +
          WEIGHT_BREADTH * breadth),
    );

    suggestions.push({
      query: group.query,
      score,
      searchVolume: group.searchVolume,
      difficulty: group.difficulty,
      intent: group.intent,
      competitorCount: group.positions.size,
      bestPosition: group.bestPosition,
      domains: [...group.positions.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([domain]) => domain),
    });
  }

  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.competitorCount - a.competitorCount ||
        (a.difficulty ?? 100) - (b.difficulty ?? 100) ||
        a.query.localeCompare(b.query),
    )
    .slice(0, maxSuggestions);
}

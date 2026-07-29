import { type SerpObservation } from "@/domain/seo/serp-facts";
import { hostKey } from "@/domain/seo/property-id";
import { normalize } from "@/domain/seo/text";

/**
 * Layer 3: "eyeball who's weak" — made measurable.
 *
 * Difficulty answers *how hard is it to rank*. This answers a different and
 * more actionable question: **how soft is the page currently there**. A keyword
 * with difficulty 45 whose top ten is four Reddit threads and three directory
 * listings is a better target than one at difficulty 30 held by seven purpose-
 * built pages, and no single vendor number expresses that.
 *
 * Every operand is returned alongside the score. The number is a sort order, not
 * a verdict — a reviewer who disagrees can read the facts that produced it and
 * overrule at the gate. That is the same contract as every other score here:
 * facts are computed, judgment stays human.
 *
 * **No page crawl.** This runs over the SERP alone, at ~$0.002 a keyword, so it
 * can screen dozens of finalists. Layer 4 does the expensive per-page work on
 * whatever survives.
 *
 * Pure.
 */

/**
 * Domains whose presence in a top ten signals nobody has built a purpose-made
 * page for the query. Deliberately short and generic — a per-vertical list
 * belongs in tag config, and this is the obvious thing to make configurable
 * once real output says the default is wrong.
 */
const UGC_DOMAINS = [
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "stackoverflow.com",
  "answers.com",
  "medium.com",
  "pinterest.com",
  "facebook.com",
  "tumblr.com",
];

/** Aggregators and listing sites — present for the same reason, ranked weaker. */
const DIRECTORY_DOMAINS = [
  "yelp.com",
  "yellowpages.com",
  "thumbtack.com",
  "angi.com",
  "angieslist.com",
  "houzz.com",
  "tripadvisor.com",
  "bbb.org",
  "manta.com",
];

/** Path fragments that mark a forum thread on a domain not in the list above. */
const FORUM_PATH_HINTS = ["/forum", "/thread", "/topic", "/discussion", "/board"];

export interface SerpWeaknessFacts {
  /** Organic results observed. The denominator for every share below. */
  resultCount: number;
  ugcResults: number;
  directoryResults: number;
  /**
   * Share of results whose title carries every significant term of the query.
   * Low coverage means nobody is targeting it precisely — the SERP is a loose
   * match Google assembled, not a field of purpose-built competitors.
   */
  titleTermCoverage: number;
  distinctDomains: number;
  /** Which of our tracked competitors hold this SERP. */
  knownCompetitors: string[];
  features: string[];
  /** Our own position, when we appear at all. */
  ourPosition: number | null;
}

export interface SerpWeakness {
  /** 0–100. Higher means the page currently there is softer. */
  score: number;
  facts: SerpWeaknessFacts;
}

/** Weights, exposed as named constants so the score is readable, not magic. */
const UGC_WEIGHT = 40;
const DIRECTORY_WEIGHT = 20;
const LOOSE_TITLE_WEIGHT = 40;
/**
 * An AI Overview suppresses clicks regardless of how soft the blue links are,
 * so a weak SERP under one is worth materially less than the same SERP without.
 */
const AI_OVERVIEW_PENALTY = 15;

export function computeSerpWeakness(input: {
  observation: SerpObservation;
  query: string;
  /** Our domain, so we can spot ourselves rather than counting us as rivals. */
  ourDomain: string;
  /** Approved competitors, to report which of them hold this SERP. */
  competitorDomains: string[];
}): SerpWeakness {
  const results = input.observation.results;
  const resultCount = results.length;

  if (resultCount === 0) {
    return {
      // No observation is not the same as a weak SERP. Score 0 keeps an
      // unobservable keyword out of the top of the list rather than at it.
      score: 0,
      facts: {
        resultCount: 0,
        ugcResults: 0,
        directoryResults: 0,
        titleTermCoverage: 0,
        distinctDomains: 0,
        knownCompetitors: [],
        features: input.observation.features,
        ourPosition: null,
      },
    };
  }

  const ours = hostKey(input.ourDomain);
  const tracked = new Set(input.competitorDomains.map(hostKey));

  let ugcResults = 0;
  let directoryResults = 0;
  let titleMatches = 0;
  const domains = new Set<string>();
  const knownCompetitors = new Set<string>();
  let ourPosition: number | null = null;

  const queryTerms = significantTerms(input.query);

  for (const result of results) {
    const domain = hostKey(result.domain);
    domains.add(domain);

    if (domain === ours) {
      ourPosition ??= result.position;
    } else if (tracked.has(domain)) {
      knownCompetitors.add(domain);
    }

    if (isUgc(domain, result.url)) ugcResults += 1;
    else if (isDirectory(domain)) directoryResults += 1;

    if (titleCarriesQuery(result.title, queryTerms)) titleMatches += 1;
  }

  const titleTermCoverage = titleMatches / resultCount;
  const hasAiOverview = input.observation.features.includes("ai_overview");

  const raw =
    UGC_WEIGHT * (ugcResults / resultCount) +
    DIRECTORY_WEIGHT * (directoryResults / resultCount) +
    LOOSE_TITLE_WEIGHT * (1 - titleTermCoverage) -
    (hasAiOverview ? AI_OVERVIEW_PENALTY : 0);

  return {
    score: Math.max(0, Math.min(100, Math.round(raw))),
    facts: {
      resultCount,
      ugcResults,
      directoryResults,
      titleTermCoverage: Number(titleTermCoverage.toFixed(2)),
      distinctDomains: domains.size,
      knownCompetitors: [...knownCompetitors].sort(),
      features: input.observation.features,
      ourPosition,
    },
  };
}

/** Query words worth requiring in a title — stopwords carry no targeting signal. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or", "that", "the", "to", "was", "what",
  "when", "where", "which", "who", "why", "with", "your", "you",
]);

function significantTerms(query: string): string[] {
  return normalize(query)
    .split(" ")
    .filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

/**
 * Does this title target the query, or merely happen to rank for it?
 *
 * Every significant term must appear. A partial match is what a loose SERP
 * looks like, and treating it as targeting would understate the opportunity.
 */
function titleCarriesQuery(title: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const normalized = normalize(title);
  return terms.every((term) => normalized.includes(term));
}

function isUgc(domain: string, url: string): boolean {
  if (UGC_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return true;
  }
  const path = pathOf(url);
  return FORUM_PATH_HINTS.some((hint) => path.startsWith(hint) || path.includes(hint));
}

function isDirectory(domain: string): boolean {
  return DIRECTORY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

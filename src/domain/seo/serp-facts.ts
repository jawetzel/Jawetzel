import { type PageFacts } from "./page-facts";
import { patternsOf, type TitlePatternConfig } from "./title-patterns";
import { sameProperty } from "./property-id";
import {
  collapseWhitespace,
  documentFrequency,
  dropRedundantSubPhrases,
  isQuestionHeading,
  normalize,
  phraseSet,
  spread,
} from "./text";

/**
 * Fact family 2 — "SERP facts, measured across the top 10 for the target query
 * and location" (seo.md §4b), plus the crawled bodies of those same results.
 *
 * Two sample sizes travel with these facts and must never be conflated:
 *   - `of` — how many organic competitors the SERP returned (title/meta facts)
 *   - `crawledOf` — how many of those we successfully fetched (body/schema facts)
 * A page that blocks our crawler shrinks the second without touching the first,
 * and every emitted fact says which denominator it used. That is the
 * "every fact ships with its source, its sample size, and its observation date"
 * rule, enforced at the type level.
 */

export interface SerpOrganicResult {
  position: number;
  url: string;
  domain: string;
  title: string;
  description: string | null;
}

/** One observation of a SERP — the row stored in `seo_serp_snapshots`. */
export interface SerpObservation {
  query: string;
  location: string;
  capturedAt: string;
  results: SerpOrganicResult[];
  /** `ai_overview`, `people_also_ask`, `video`, `local_pack`, … */
  features: string[];
  paaQuestions: string[];
}

/** A top-10 result we also fetched and measured. */
export interface CompetitorPage {
  position: number;
  url: string;
  facts: PageFacts;
}

/** Vertical configuration that changes which patterns are counted, never code. */
export type SerpFactsConfig = TitlePatternConfig;

/** A phrase with the sample it was observed in. */
export interface TermCount {
  term: string;
  in: number;
  of: number;
}

export interface SerpFacts {
  query: string;
  location: string;
  capturedAt: string;
  features: string[];
  /** Our own position in this SERP, or null when we are not in the returned set. */
  ourPosition: number | null;
  /** Organic competitors (top 10 minus our own domain). */
  competitorCount: number;
  /** How many competitor pages we successfully crawled. */
  crawledCount: number;
  titleLength: { min: number; median: number; max: number };
  metaLength: { min: number; median: number; max: number };
  bodyWordCount: { min: number; median: number; max: number };
  internalLinksIn: { min: number; median: number; max: number };
  titleTerms: TermCount[];
  titlePatterns: TermCount[];
  metaTerms: TermCount[];
  headings: TermCount[];
  bodyPhrases: TermCount[];
  entities: TermCount[];
  schemaTypes: TermCount[];
  questions: string[];
  titleExamples: string[];
  metaExamples: string[];
  /** Original-case representative for each normalized heading/entity phrase. */
  displayForms: Record<string, string>;
}

/**
 * Frequency map -> sorted `TermCount[]`.
 *
 * `minCount` is a noise floor for OPEN vocabularies (terms, headings, entities,
 * n-grams): one competitor using a word is not a signal, it is that page's
 * idiolect, and reporting it would bury the real distribution. Closed
 * vocabularies — the nine title patterns, schema types — pass `minCount: 1`,
 * because there is no noise to filter there and `minShare` already decides what
 * gets recommended. Applying the floor to a 2-competitor SERP would otherwise
 * silently empty the whole pattern table.
 */
function toTermCounts(
  frequencies: Map<string, number>,
  of: number,
  minCount = 2,
): TermCount[] {
  return [...frequencies.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([term, count]) => ({ term, in: count, of }));
}

/**
 * Remember one original-case spelling per normalized phrase, so the response can
 * say "Hardiness Zones" instead of "hardiness zones". First writer wins, and
 * inputs are processed in rank order, so the highest-ranking competitor's
 * casing is the one that surfaces.
 */
function rememberDisplayForm(
  into: Record<string, string>,
  original: string,
): void {
  const key = normalize(original);
  if (key !== "" && into[key] === undefined) into[key] = original.trim();
}

export function computeSerpFacts(input: {
  observation: SerpObservation;
  competitorPages: CompetitorPage[];
  ourDomain: string;
  config?: SerpFactsConfig;
}): SerpFacts {
  const { observation, competitorPages, ourDomain } = input;
  const config = input.config ?? {};

  // Host-key comparison, not string equality: the SERP may report `www.` while
  // the caller's URL omits it (or the reverse), and treating those as different
  // properties would count our own page as a competitor against itself.
  const ours = observation.results.find((r) => sameProperty(r.domain, ourDomain));
  const competitors = observation.results.filter(
    (r) => !sameProperty(r.domain, ourDomain),
  );
  const of = competitors.length;

  const displayForms: Record<string, string> = {};

  // ---- Title facts: from the SERP itself, no crawl required ----
  const titles = competitors.map((r) => r.title).filter((t) => t.trim() !== "");
  const titleTerms = documentFrequency(titles.map((t) => phraseSet(t)));
  const patternCounts = documentFrequency(
    titles.map((title) => new Set(patternsOf(title, config))),
  );

  // ---- Meta facts: descriptions as returned in the SERP ----
  const metas = competitors
    .map((r) => r.description ?? "")
    .filter((d) => d.trim() !== "");
  const metaTerms = documentFrequency(metas.map((d) => phraseSet(d)));

  // ---- Body facts: only from pages we actually fetched ----
  const crawled = [...competitorPages].sort((a, b) => a.position - b.position);
  const crawledOf = crawled.length;

  const headingFrequency = documentFrequency(
    crawled.map((page) => {
      const set = new Set<string>();
      for (const heading of page.facts.headings) {
        rememberDisplayForm(displayForms, heading.text);
        set.add(normalize(heading.text));
      }
      set.delete("");
      return set;
    }),
  );

  const bodyPhrases = documentFrequency(crawled.map((p) => p.facts.phrases));
  const entities = documentFrequency(
    crawled.map((page) => {
      // The map carries each entity's original casing; frequency counts the
      // normalized keys.
      for (const original of page.facts.properNouns.values()) {
        rememberDisplayForm(displayForms, original);
      }
      return new Set(page.facts.properNouns.keys());
    }),
  );
  const schemaTypes = documentFrequency(
    crawled.map((p) => new Set(p.facts.schemaTypes)),
  );

  // Questions the ranking set answers: Google's own PAA block, plus any
  // question-shaped heading a competitor uses. Both are observed, neither is
  // generated.
  const questions: string[] = [];
  const seenQuestions = new Set<string>();
  for (const question of observation.paaQuestions) {
    const key = normalize(question);
    if (key !== "" && !seenQuestions.has(key)) {
      seenQuestions.add(key);
      questions.push(collapseWhitespace(question));
    }
  }
  for (const page of crawled) {
    for (const heading of page.facts.headings) {
      // Scraped headings are noisy — require a real interrogative shape, not just
      // a trailing "?", so a "Didn't find what you need?" CTA doesn't land here.
      if (!isQuestionHeading(heading.text)) continue;
      const key = normalize(heading.text);
      if (key === "" || seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      questions.push(collapseWhitespace(heading.text));
    }
  }

  return {
    query: observation.query,
    location: observation.location,
    capturedAt: observation.capturedAt,
    features: [...observation.features].sort(),
    ourPosition: ours?.position ?? null,
    competitorCount: of,
    crawledCount: crawledOf,
    titleLength: spread(titles.map((t) => t.length)),
    metaLength: spread(metas.map((d) => d.length)),
    bodyWordCount: spread(crawled.map((p) => p.facts.wordCount)),
    internalLinksIn: spread(crawled.map((p) => p.facts.internalLinksOut)),
    // Free-text tables get sub-phrase collapsing; the closed vocabularies
    // (patterns, schema types) and exact-match tables (headings, entities) do
    // not — "Best Varieties" is one heading, not a phrase to decompose.
    titleTerms: toTermCounts(dropRedundantSubPhrases(titleTerms), of),
    titlePatterns: toTermCounts(patternCounts, of, 1),
    metaTerms: toTermCounts(dropRedundantSubPhrases(metaTerms), of),
    headings: toTermCounts(headingFrequency, crawledOf),
    bodyPhrases: toTermCounts(dropRedundantSubPhrases(bodyPhrases), crawledOf),
    entities: toTermCounts(entities, crawledOf),
    schemaTypes: toTermCounts(schemaTypes, crawledOf, 1),
    questions,
    // Verbatim examples from the pages currently ranking — seo.md calls this the
    // highest-value field for an AI consumer, and it is free from data we store.
    titleExamples: titles.slice(0, 5),
    metaExamples: metas.slice(0, 3),
    displayForms,
  };
}

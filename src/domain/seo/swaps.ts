import { type DeltaFacts, isRecommended } from "./delta-facts";
import { type PageFacts } from "./page-facts";
import { type SerpFacts, type TermCount } from "./serp-facts";

/**
 * The response shape — "a flat list of swaps: what they have, what the data says
 * to use, and a score for each" (seo.md §4b).
 *
 * The four fact families are internal computation; this is the only thing the
 * consumer sees. Two shapes, and the split is deliberate:
 *
 *   - `suggested` — headings · facts · entities · questions · schema · links ·
 *     length. The observed competitor data *is* the answer, so we hand over the
 *     set to add.
 *   - `signals`  — title · meta. Raw ingredients only: term frequencies,
 *     structural patterns, median length, and verbatim competitor examples.
 *     **We never write prose the caller ships.** A templated title is
 *     deterministic but reads mechanically, and any consumer with a model writes
 *     something better from the signals than our template could.
 *
 * No rationale is emitted anywhere. The consumer asked for values, not argument.
 */

export type SwapArea =
  | "title"
  | "meta"
  | "headings"
  | "facts"
  | "entities"
  | "questions"
  | "schema"
  | "links"
  | "length";

export interface SwapSignals {
  terms?: TermCount[];
  patterns?: TermCount[];
  lengthMedian?: number;
  examples?: string[];
}

export interface Swap {
  area: SwapArea;
  current: string | string[] | number | null;
  currentScore: number;
  suggested?: string[] | number;
  suggestedScore: number;
  signals?: SwapSignals;
  /** Only populated for `?include=provenance` — every feature considered. */
  provenance?: TermCount[];
}

/**
 * Score = percentage of observed competitive features matched, weighted by
 * frequency across the top 10 (seo.md §4b). Pure arithmetic.
 *
 * `currentScore` weighs what the page already matches. `suggestedScore` weighs
 * what it would match after adopting every *recommended* feature — those at or
 * above `minShare`. Features below that line still count in the denominator,
 * which is why a suggested score lands in the eighties rather than at 100: the
 * long tail of things one or two competitors do is observable, reported, and
 * deliberately not something we tell you to chase.
 */
function weightedScore(
  features: ReadonlyArray<{ feature: TermCount; present: boolean }>,
  minShare: number,
): { currentScore: number; suggestedScore: number } {
  let total = 0;
  let current = 0;
  let suggested = 0;
  for (const { feature, present } of features) {
    const weight = feature.of > 0 ? feature.in / feature.of : 0;
    total += weight;
    if (present) current += weight;
    if (present || isRecommended(feature, minShare)) suggested += weight;
  }
  if (total === 0) return { currentScore: 0, suggestedScore: 0 };
  return {
    currentScore: Math.round((current / total) * 100),
    suggestedScore: Math.round((suggested / total) * 100),
  };
}

/**
 * Pair each observed feature with whether the page already has it, given the
 * set of terms the delta pass reported missing. One helper for every set-shaped
 * area, so "present" always means the same thing.
 */
function markPresence(
  observed: readonly TermCount[],
  missing: readonly TermCount[],
): Array<{ feature: TermCount; present: boolean }> {
  const missingTerms = new Set(missing.map((m) => m.term));
  return observed.map((feature) => ({
    feature,
    present: !missingTerms.has(feature.term),
  }));
}

/**
 * Score for a numeric area (`links`, `length`): distance from the observed
 * median, as a percentage. Adopting the median scores 100 — unlike the set
 * areas there is no long tail to leave on the table, because "how many" has a
 * single observed answer rather than a distribution of features.
 */
function bandScore(value: number, median: number): number {
  if (median <= 0) return value > 0 ? 100 : 0;
  const ratio = 1 - Math.abs(value - median) / median;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/** Original-case spelling for a normalized phrase, falling back to the phrase. */
function display(serp: SerpFacts, term: string): string {
  return serp.displayForms[term] ?? term;
}

function recommended(terms: readonly TermCount[], minShare: number): TermCount[] {
  return terms.filter((t) => isRecommended(t, minShare));
}

/** First-spelling-wins dedupe, case-insensitive — for the additive schema set. */
function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export interface BuildSwapsInput {
  page: PageFacts;
  serp: SerpFacts;
  delta: DeltaFacts;
  minShare: number;
  /** Attach the full considered-feature list to each swap. */
  includeProvenance: boolean;
  /** Cap on suggested-set length, so a sheet stays actionable. */
  maxSuggestions?: number;
}

export function buildSwaps(input: BuildSwapsInput): Swap[] {
  const { page, serp, delta, minShare, includeProvenance } = input;
  const limit = input.maxSuggestions ?? 12;
  const swaps: Swap[] = [];

  const withProvenance = (swap: Swap, features: TermCount[]): Swap =>
    includeProvenance ? { ...swap, provenance: features } : swap;

  // ---- title (signals shape) ----
  if (serp.competitorCount > 0) {
    // Terms and structural patterns are scored in one pool — a title that
    // carries the right words but none of the shape is genuinely half-matched.
    const marked = [
      ...markPresence(serp.titleTerms, delta.titleMissingTerms),
      ...markPresence(serp.titlePatterns, delta.titleMissingPatterns),
    ];
    const features = marked.map((m) => m.feature);
    const { currentScore, suggestedScore } = weightedScore(marked, minShare);
    swaps.push(
      withProvenance(
        {
          area: "title",
          current: page.title,
          currentScore,
          suggestedScore,
          signals: {
            terms: recommended(delta.titleMissingTerms, minShare).slice(0, limit),
            patterns: recommended(delta.titleMissingPatterns, minShare),
            lengthMedian: serp.titleLength.median,
            examples: serp.titleExamples,
          },
        },
        features,
      ),
    );
  }

  // ---- meta (signals shape) ----
  if (serp.metaTerms.length > 0 || page.metaDescription === null) {
    const { currentScore, suggestedScore } = weightedScore(
      markPresence(serp.metaTerms, delta.metaMissingTerms),
      minShare,
    );
    swaps.push(
      withProvenance(
        {
          area: "meta",
          current: page.metaDescription,
          currentScore: page.metaDescription === null ? 0 : currentScore,
          suggestedScore,
          signals: {
            terms: recommended(delta.metaMissingTerms, minShare).slice(0, limit),
            lengthMedian: serp.metaLength.median,
            examples: serp.metaExamples,
          },
        },
        serp.metaTerms,
      ),
    );
  }

  // ---- headings (suggested shape) ----
  if (serp.headings.length > 0) {
    const { currentScore, suggestedScore } = weightedScore(
      markPresence(serp.headings, delta.missingHeadings),
      minShare,
    );
    swaps.push(
      withProvenance(
        {
          area: "headings",
          current: page.headings.map((h) => h.text),
          currentScore,
          suggested: recommended(delta.missingHeadings, minShare)
            .slice(0, limit)
            .map((h) => display(serp, h.term)),
          suggestedScore,
        },
        serp.headings,
      ),
    );
  }

  // ---- facts (suggested shape) — the entitySchema coverage check ----
  const entityFieldCount =
    delta.presentEntityFields.length + delta.missingEntityFields.length;
  if (entityFieldCount > 0) {
    swaps.push({
      area: "facts",
      current: delta.presentEntityFields,
      currentScore: Math.round(
        (delta.presentEntityFields.length / entityFieldCount) * 100,
      ),
      suggested: delta.missingEntityFields,
      suggestedScore: 100,
    });
  }

  // ---- entities (suggested shape) ----
  if (serp.entities.length > 0) {
    const missing = new Set(delta.missingEntities.map((e) => e.term));
    const { currentScore, suggestedScore } = weightedScore(
      markPresence(serp.entities, delta.missingEntities),
      minShare,
    );
    swaps.push(
      withProvenance(
        {
          area: "entities",
          current: serp.entities
            .filter((e) => !missing.has(e.term))
            .slice(0, limit)
            .map((e) => display(serp, e.term)),
          currentScore,
          suggested: recommended(delta.missingEntities, minShare)
            .slice(0, limit)
            .map((e) => display(serp, e.term)),
          suggestedScore,
        },
        serp.entities,
      ),
    );
  }

  // ---- questions (suggested shape) ----
  if (serp.questions.length > 0) {
    const unanswered = new Set(delta.unansweredQuestions);
    const answered = serp.questions.filter((q) => !unanswered.has(q));
    swaps.push({
      area: "questions",
      current: answered,
      currentScore: Math.round((answered.length / serp.questions.length) * 100),
      suggested: delta.unansweredQuestions.slice(0, limit),
      suggestedScore: 100,
    });
  }

  // ---- schema (suggested shape) ----
  if (serp.schemaTypes.length > 0) {
    const { currentScore, suggestedScore } = weightedScore(
      markPresence(serp.schemaTypes, delta.missingSchemaTypes),
      minShare,
    );
    const additions = recommended(delta.missingSchemaTypes, minShare).map((s) =>
      display(serp, s.term),
    );
    swaps.push(
      withProvenance(
        {
          area: "schema",
          current: page.schemaTypes,
          currentScore,
          // Schema is additive — the suggestion is the full set to end up with,
          // deduped case-insensitively so a type the page already has never
          // appears twice.
          suggested: dedupeCaseInsensitive([...page.schemaTypes, ...additions]),
          suggestedScore,
        },
        serp.schemaTypes,
      ),
    );
  }

  // ---- links (numeric) ----
  // NOTE: seo.md's `links` area asks "how many *inbound* internal links it
  // needs", which requires a site-wide crawl this endpoint does not do (it
  // fetches exactly one URL of yours). What is measured here is internal links
  // *out*, against the same measure across the crawled top 10 — the archetype-A
  // "does this page link onward?" question. Documented in API.md so no consumer
  // mistakes one for the other.
  if (serp.crawledCount > 0) {
    swaps.push({
      area: "links",
      current: page.internalLinksOut,
      currentScore: bandScore(
        page.internalLinksOut,
        serp.internalLinksIn.median,
      ),
      suggested: serp.internalLinksIn.median,
      suggestedScore: 100,
    });
  }

  // ---- length (numeric) ----
  if (serp.crawledCount > 0) {
    swaps.push({
      area: "length",
      current: page.wordCount,
      currentScore: bandScore(page.wordCount, serp.bodyWordCount.median),
      suggested: serp.bodyWordCount.median,
      suggestedScore: 100,
    });
  }

  // "Sort by suggestedScore - currentScore and the top row is the
  // highest-leverage change." Ties break on area name so runs stay diffable.
  return swaps.sort(
    (a, b) =>
      b.suggestedScore -
        b.currentScore -
        (a.suggestedScore - a.currentScore) ||
      a.area.localeCompare(b.area),
  );
}

import { containsPhrase, isQuestion } from "./text";

/**
 * The structural title shapes we count across a SERP — "Count containing city /
 * number / year / urgency term / brand" (seo.md §4b, fact family 2).
 *
 * ONE table, used by both sides of the comparison: `serp-facts` runs it over the
 * top 10 to build the frequency distribution, `delta-facts` runs it over the
 * caller's title to decide which of those shapes they are missing. Two copies of
 * these predicates would silently disagree the first time either was edited, and
 * the disagreement would surface as a confident, wrong recommendation.
 *
 * Two predicates depend on per-vertical configuration (`city`, `urgencyTerms`),
 * which is why this is a factory rather than a constant: the same config object
 * that shaped the SERP table shapes the delta test.
 */

export interface TitlePatternConfig {
  /** Vertical vocabulary — seo.md §2 `urgencyTerms`. */
  urgencyTerms?: string[];
  /** Locale token for archetype-A title composition counts. */
  city?: string | null;
}

export type TitlePatternTests = Record<string, (title: string) => boolean>;

export function titlePatternTests(
  config: TitlePatternConfig = {},
): TitlePatternTests {
  return {
    leadsWithCount: (t) => /^\s*\d+\b/.test(t),
    containsNumber: (t) => /\d/.test(t),
    containsYear: (t) => /\b20\d{2}\b/.test(t),
    isQuestion: (t) => isQuestion(t),
    containsSuperlative: (t) =>
      /\b(best|top|ultimate|complete|essential|guide)\b/i.test(t),
    usesSeparator: (t) => /[|—–:]/.test(t),
    containsParenthetical: (t) => /\(.+\)/.test(t),
    containsCity: (t) =>
      Boolean(config.city) && containsPhrase(t, config.city as string),
    containsUrgencyTerm: (t) =>
      (config.urgencyTerms ?? []).some((term) => containsPhrase(t, term)),
  };
}

/** Which patterns a single title exhibits. */
export function patternsOf(
  title: string,
  config: TitlePatternConfig = {},
): string[] {
  if (title.trim() === "") return [];
  return Object.entries(titlePatternTests(config))
    .filter(([, test]) => test(title))
    .map(([id]) => id);
}

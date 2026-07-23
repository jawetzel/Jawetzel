import { detectsEntityField, type PageFacts } from "./page-facts";
import { type SerpFacts, type TermCount } from "./serp-facts";
import { patternsOf, type TitlePatternConfig } from "./title-patterns";
import { containsPhrase, normalize } from "./text";

/**
 * Fact family 3 — "delta facts: set arithmetic and numeric comparison, wholly
 * deterministic" (seo.md §4b).
 *
 * Every field here is `observed on the ranking set` minus `observed on your
 * page`. Nothing is inferred and nothing is ranked by taste — the only judgment
 * in the whole file is `minShare`, which is a threshold, lives in config, and is
 * echoed back in the response so a consumer who disagrees can re-derive it from
 * the raw facts.
 */

export interface DeltaFactsConfig extends TitlePatternConfig {
  /**
   * A feature counts as a *recommendation* once this share of the sampled
   * competitors use it. Below the line it is still reported as observed, it just
   * doesn't become something we tell you to add. Default 0.3 — i.e. 3 of 10.
   */
  minShare: number;
  /** The vertical's fact types (seo.md §2 `entitySchema`). */
  entitySchema: string[];
}

export const DEFAULT_MIN_SHARE = 0.3;

export interface DeltaFacts {
  titleMissingTerms: TermCount[];
  titleMissingPatterns: TermCount[];
  metaMissingTerms: TermCount[];
  missingHeadings: TermCount[];
  missingBodyPhrases: TermCount[];
  missingEntities: TermCount[];
  unansweredQuestions: string[];
  missingSchemaTypes: TermCount[];
  /** `entitySchema` fields with no detected value on the page. */
  missingEntityFields: string[];
  presentEntityFields: string[];
  /** Page word count minus the top-10 median. Negative means thinner. */
  wordCountDelta: number;
  /** Internal links out minus the top-10 median. */
  internalLinksDelta: number;
}

/** A feature observed often enough to be worth recommending. */
export function isRecommended(term: TermCount, minShare: number): boolean {
  return term.of > 0 && term.in / term.of >= minShare;
}

/** Terms the ranking set uses that this text does not contain. */
function missingFrom(text: string, terms: TermCount[]): TermCount[] {
  return terms.filter((t) => !containsPhrase(text, t.term));
}

export function computeDeltaFacts(input: {
  page: PageFacts;
  serp: SerpFacts;
  config: DeltaFactsConfig;
}): DeltaFacts {
  const { page, serp, config } = input;

  const title = page.title ?? "";
  const meta = page.metaDescription ?? "";

  // Same predicate table that built the SERP distribution, same config — so
  // "7 of 10 lead with a count, you don't" can never be a drift artifact.
  const ourPatterns = new Set(patternsOf(title, config));
  const titleMissingPatterns = serp.titlePatterns.filter(
    (p) => !ourPatterns.has(p.term),
  );

  const pageHeadings = new Set(page.headings.map((h) => normalize(h.text)));
  const pageSchema = new Set(page.schemaTypes.map((t) => normalize(t)));

  const presentEntityFields = config.entitySchema.filter((field) =>
    detectsEntityField(page, field),
  );
  const presentFieldSet = new Set(presentEntityFields);

  return {
    titleMissingTerms: missingFrom(title, serp.titleTerms),
    titleMissingPatterns,
    metaMissingTerms: missingFrom(meta, serp.metaTerms),
    missingHeadings: serp.headings.filter((h) => !pageHeadings.has(h.term)),
    // Body phrases are matched against the page's own phrase set rather than a
    // substring scan — same normalization on both sides, so "cold hardy" only
    // matches a real adjacent pair.
    missingBodyPhrases: serp.bodyPhrases.filter((p) => !page.phrases.has(p.term)),
    missingEntities: serp.entities.filter(
      (e) => !page.properNouns.has(e.term) && !page.phrases.has(e.term),
    ),
    unansweredQuestions: serp.questions.filter(
      (q) => !questionIsAnswered(q, page),
    ),
    // Schema types are PascalCase identifiers ("ProfessionalService"); the SERP
    // side carries them raw while `pageSchema` is normalized, so normalize the
    // SERP term too or every present type reads as missing (currentScore 0).
    missingSchemaTypes: serp.schemaTypes.filter(
      (s) => !pageSchema.has(normalize(s.term)),
    ),
    missingEntityFields: config.entitySchema.filter(
      (field) => !presentFieldSet.has(field),
    ),
    presentEntityFields,
    wordCountDelta: page.wordCount - serp.bodyWordCount.median,
    internalLinksDelta: page.internalLinksOut - serp.internalLinksIn.median,
  };
}

/**
 * A question counts as answered when the page's headings carry most of its
 * content words, or the body states nearly all of them. Deliberately generous on
 * the heading side (a section titled "Planting Time" answers "when to plant trees
 * in cold climates") and strict on the body side, because a page that merely uses
 * the words somewhere has not structured an answer.
 */
function questionIsAnswered(question: string, page: PageFacts): boolean {
  const terms = [...new Set(question.split(/\s+/))]
    .map((w) => normalize(w))
    .filter((w) => w.length > 2);
  if (terms.length === 0) return true;

  const headingText = page.headings.map((h) => h.text).join(" ");
  const matchedInHeadings = terms.filter((t) =>
    containsPhrase(headingText, t),
  ).length;
  if (matchedInHeadings / terms.length >= 0.6) return true;

  const matchedInBody = terms.filter((t) => page.phrases.has(t)).length;
  return matchedInBody / terms.length >= 0.9;
}

/**
 * Pure text primitives shared by every SEO detector.
 *
 * Everything here is a deterministic string/array function with zero I/O — the
 * whole advisory engine is "a pure function of stored inputs" (seo.md §4b), and
 * these are its arithmetic. No stemming, no synonyms, no model: coverage
 * detection is frequency analysis, deliberately cruder than a model would be and
 * exactly reproducible run over run.
 *
 * (`seo.md` Part 8 leaves "does entitySchema detection need stemming/synonyms"
 * open. This module answers "not yet" — exact normalized matching. When that
 * question closes, it closes here and nowhere else.)
 */

/**
 * Function words stripped before frequency counting. Intentionally short: this
 * is not linguistics, it is noise removal so that "the" doesn't out-rank "zone"
 * in a term-frequency table.
 */
const STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as",
  "at", "be", "because", "been", "before", "being", "between", "both", "but",
  "by", "can", "could", "did", "do", "does", "doing", "don", "down", "during",
  "each", "few", "for", "from", "further", "had", "has", "have", "having", "he",
  "her", "here", "hers", "him", "his", "how", "i", "if", "in", "into", "is",
  "it", "its", "just", "me", "more", "most", "my", "no", "nor", "not", "now",
  "of", "off", "on", "once", "only", "or", "other", "our", "ours", "out",
  "over", "own", "s", "same", "she", "should", "so", "some", "such", "t",
  "than", "that", "the", "their", "theirs", "them", "then", "there", "these",
  "they", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who",
  "whom", "why", "will", "with", "would", "you", "your", "yours",
]);

/** Words that open a question — used to spot question-shaped headings/titles. */
const QUESTION_OPENERS = new Set([
  "how", "what", "why", "when", "where", "which", "who", "can", "should",
  "does", "do", "is", "are", "will",
]);

/**
 * Boilerplate that survives capitalization but names no entity — cookie-banner
 * buttons, nav chrome, legal footers. These slip through `properNounPhrases`
 * because "Accept" or "Menu" is a capitalized word like any proper noun, so they
 * are excluded by name. Deliberately chrome-only: nothing domain-adjacent
 * ("Legacy", "Services") lives here, since one vertical's chrome is another's
 * subject.
 */
const PROPER_NOUN_STOPWORDS = new Set([
  "accept", "cookie", "cookies", "menu", "home", "login", "logout", "signin",
  "signup", "register", "subscribe", "newsletter", "skip", "close", "toggle",
  "share", "follow", "submit", "next", "previous", "back", "copyright",
  "privacy", "terms",
]);

/**
 * Lowercase, strip everything that isn't a letter/digit/space, collapse runs of
 * whitespace. The single normalization used everywhere, so a term extracted from
 * a competitor title and the same term matched against our body always agree.
 * Apostrophes are dropped rather than spaced ("don't" -> "dont") to keep
 * contractions one token.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Flatten a captured string to one clean line: collapse every run of whitespace
 * (including the block-boundary newlines `textOf` preserves) to a single space,
 * drop the stray space that inline text-splitting leaves before punctuation
 * ("…plug in ." -> "…plug in."), and trim. Used wherever a value is shown or
 * treated as a single line — headings, questions — never on the prose body,
 * whose newlines the entity splitter depends on.
 */
export function collapseWhitespace(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/** Normalized whitespace-separated tokens. `""` yields `[]`, never `[""]`. */
export function tokenize(input: string): string[] {
  const normalized = normalize(input);
  return normalized === "" ? [] : normalized.split(" ");
}

/** Tokens minus stopwords and bare single characters. */
export function contentWords(input: string): string[] {
  return tokenize(input).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

/**
 * Contiguous n-grams over the *unfiltered* token stream, then dropped if they
 * start or end on a stopword. Filtering stopwords first would fuse words that
 * were never adjacent ("trees for zone" -> "trees zone"); filtering after keeps
 * phrases real while still discarding "of the" and "in a".
 */
export function nGrams(input: string, n: number): string[] {
  const tokens = tokenize(input);
  if (n < 1 || tokens.length < n) return [];
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) {
    const window = tokens.slice(i, i + n);
    const first = window[0];
    const last = window[window.length - 1];
    if (STOPWORDS.has(first) || STOPWORDS.has(last)) continue;
    if (window.every((t) => t.length < 2)) continue;
    grams.push(window.join(" "));
  }
  return grams;
}

/**
 * Every phrase a document "contains" for frequency purposes: content unigrams
 * plus 2- and 3-grams, deduped. Deduping matters — these tables count *document
 * frequency* ("in 8 of 10 titles"), never raw occurrences, so a page repeating
 * "cold hardy" twelve times still contributes exactly one.
 */
export function phraseSet(input: string): Set<string> {
  const phrases = new Set<string>();
  for (const word of contentWords(input)) phrases.add(word);
  for (const gram of nGrams(input, 2)) phrases.add(gram);
  for (const gram of nGrams(input, 3)) phrases.add(gram);
  return phrases;
}

/**
 * Whole-token phrase containment. Padding both sides with spaces is what keeps
 * "zone" from matching "ozone" — a substring test on normalized text would.
 */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const normalizedPhrase = normalize(phrase);
  if (normalizedPhrase === "") return false;
  return ` ${normalize(haystack)} `.includes(` ${normalizedPhrase} `);
}

/**
 * Document frequency: for each phrase, how many documents contain it. The
 * numerator behind every `{ "term": "cold hardy", "in": 8, "of": 10 }` in the
 * response. Sorted by count desc, then alphabetically so identical inputs always
 * serialize identically (the doc's diffability requirement).
 */
export function documentFrequency(
  documents: ReadonlyArray<Set<string>>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    for (const phrase of doc) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return new Map(
    [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  );
}

/**
 * Drop n-grams that carry no information beyond a longer one.
 *
 * `phraseSet` emits every unigram, bigram and trigram, so a title table for
 * "Cold Hardy Trees" reports `cold`, `hardy`, `trees`, `cold hardy`,
 * `hardy trees` and `cold hardy trees` — all at the same document frequency,
 * because they always co-occur. Reporting all six is noise, and worse, it lets
 * one phrase contribute six times its weight to a score's denominator, drowning
 * out the structural patterns it competes with.
 *
 * The rule: a phrase is redundant when a LONGER phrase with the SAME count
 * contains it. Equal counts are what make it safe — if "zone" appears in 8
 * titles and "zone 3" in only 4, both are real facts and both survive. The
 * longest form is the one kept, since it says strictly more.
 */
export function dropRedundantSubPhrases(
  counts: Map<string, number>,
): Map<string, number> {
  // Longest first, so a phrase is only ever tested against phrases that could
  // actually contain it.
  const ordered = [...counts.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );
  const kept: Array<[string, number]> = [];

  for (const [phrase, count] of ordered) {
    const redundant = kept.some(
      ([keptPhrase, keptCount]) =>
        keptCount === count &&
        keptPhrase.length > phrase.length &&
        ` ${keptPhrase} `.includes(` ${phrase} `),
    );
    if (!redundant) kept.push([phrase, count]);
  }

  // Restore the caller's ordering contract: count desc, then alphabetical.
  return new Map(
    kept.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

/**
 * Capitalized runs — the `entities` area's raw material ("paper birch" is
 * lowercase in prose, "Norway Spruce" is not, so this finds the branded/proper
 * half and the n-gram table finds the rest).
 *
 * Operates on ORIGINAL-CASE text by necessity, which makes sentence-initial
 * capitalization the whole difficulty: it is grammatical, not a signal. The rule
 * that resolves it is *length*, not position — a lone capitalized word opening a
 * sentence ("Trees grow slowly") is discarded, but a multi-word capitalized run
 * ("Paper Birch thrives here") is kept, because English does not capitalize two
 * consecutive words by grammar alone. Dropping the whole first word instead
 * would silently truncate every entity that happens to start a sentence.
 */
export function properNounPhrases(text: string): Map<string, string> {
  // Normalized phrase -> the first original-case spelling seen, so the response
  // can say "Paper Birch" rather than "paper birch".
  const found = new Map<string, string>();
  // Two kinds of boundary: sentence punctuation followed by space, and a bare
  // newline (which `page-facts` emits between block elements — there is no
  // trailing space after it to anchor a lookbehind on).
  for (const sentence of text.split(/(?<=[.!?:;])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    let run: string[] = [];
    let runStart = -1;

    const flush = (): void => {
      // A single capitalized word at position 0 is just a sentence opening.
      if (run.length > 1 || runStart > 0) {
        const original = run.join(" ");
        const key = normalize(original);
        if (key !== "" && !found.has(key)) found.set(key, original);
      }
      run = [];
      runStart = -1;
    };

    words.forEach((raw, index) => {
      const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      const isCapitalized =
        /^[A-Z][a-z]+$/.test(word) || /^[A-Z]{2,}$/.test(word);
      const lower = word.toLowerCase();
      if (
        isCapitalized &&
        !STOPWORDS.has(lower) &&
        !PROPER_NOUN_STOPWORDS.has(lower)
      ) {
        if (run.length === 0) runStart = index;
        run.push(word);
        return;
      }
      if (run.length > 0) flush();
    });
    if (run.length > 0) flush();
  }
  return found;
}

/** True when the string opens on an interrogative — used for `questions`. */
export function isQuestion(text: string): boolean {
  const tokens = tokenize(text);
  return (
    text.trim().endsWith("?") ||
    (tokens.length > 0 && QUESTION_OPENERS.has(tokens[0]))
  );
}

/**
 * Stricter than {@link isQuestion}: a heading counts as a question only when it
 * BOTH opens on an interrogative AND ends with a question mark. Competitor
 * headings are noisy — a CTA like "Didn't Find What You Were Looking For?" ends
 * with "?" but is not a searchable question — so the `questions` area applies
 * this two-sided test to scraped headings while still trusting Google's own PAA
 * block verbatim.
 */
export function isQuestionHeading(text: string): boolean {
  const tokens = tokenize(text);
  return (
    text.trim().endsWith("?") &&
    tokens.length > 0 &&
    QUESTION_OPENERS.has(tokens[0])
  );
}

/** Word count over normalized tokens. */
export function wordCount(text: string): number {
  return tokenize(text).length;
}

/** Lower median (index `floor((n-1)/2)`) so the result is always an observed value. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** `{min, median, max}` over a numeric sample; all zero for an empty sample. */
export function spread(values: readonly number[]): {
  min: number;
  median: number;
  max: number;
} {
  if (values.length === 0) return { min: 0, median: 0, max: 0 };
  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
  };
}

/**
 * FNV-1a over the normalized text. Used only for change detection on
 * `page_snapshots` ("write only when contentHash changes"), never for security —
 * which is why a non-cryptographic hash is the right call: it keeps the domain
 * layer free of `node:crypto` and stays pure.
 */
export function contentHash(text: string): string {
  const normalized = normalize(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range via Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

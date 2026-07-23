import { describe, it, expect } from "vitest";
import {
  collapseWhitespace,
  containsPhrase,
  contentHash,
  contentWords,
  documentFrequency,
  dropRedundantSubPhrases,
  isQuestion,
  isQuestionHeading,
  median,
  nGrams,
  normalize,
  phraseSet,
  properNounPhrases,
  spread,
  tokenize,
  wordCount,
} from "./text";

describe("collapseWhitespace", () => {
  it("flattens block-boundary newlines to a single line", () => {
    expect(collapseWhitespace("live\nenterprise environment?")).toBe(
      "live enterprise environment?",
    );
  });

  it("drops the stray space inline-splitting leaves before punctuation", () => {
    expect(collapseWhitespace("Four ways I plug in .")).toBe(
      "Four ways I plug in.",
    );
  });

  it("collapses runs of spaces and tabs and trims", () => {
    expect(collapseWhitespace("  a   b\t c ")).toBe("a b c");
  });
});

describe("isQuestionHeading", () => {
  it("accepts a heading that opens interrogative and ends with a question mark", () => {
    expect(isQuestionHeading("What is legacy modernization?")).toBe(true);
    expect(isQuestionHeading("Is replacing a legacy system worth it?")).toBe(true);
  });

  it("rejects a CTA that merely ends with a question mark", () => {
    expect(isQuestionHeading("Didn't Find What You Were Looking For?")).toBe(
      false,
    );
  });

  it("rejects an interrogative opener with no question mark", () => {
    expect(isQuestionHeading("What we do")).toBe(false);
  });
});

describe("properNounPhrases — boilerplate", () => {
  it("does not treat cookie-banner / nav chrome as entities", () => {
    const found = properNounPhrases("We use cookies. Accept Cookies or Close.");
    expect([...found.keys()]).not.toContain("accept");
    expect([...found.keys()]).not.toContain("cookies");
  });

  it("still keeps a real proper noun that sits near the chrome", () => {
    const found = properNounPhrases(
      "Accept Cookies. We deployed Paper Birch widely.",
    );
    expect([...found.keys()]).toContain("paper birch");
  });
});

describe("normalize / tokenize", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalize("  Cold-Hardy   TREES!  ")).toBe("cold hardy trees");
  });

  it("keeps contractions as one token rather than splitting them", () => {
    expect(normalize("don't")).toBe("dont");
  });

  it("yields an empty array (not [\"\"]) for empty input", () => {
    expect(tokenize("   ")).toEqual([]);
  });

  it("drops stopwords and single characters from content words", () => {
    expect(contentWords("the best trees for a zone 3 garden")).toEqual([
      "best",
      "trees",
      "zone",
      "garden",
    ]);
  });
});

describe("nGrams", () => {
  it("never fuses words that were not adjacent", () => {
    // "trees for zone" must not become the bigram "trees zone".
    expect(nGrams("trees for zone", 2)).not.toContain("trees zone");
  });

  it("drops grams that start or end on a stopword", () => {
    const grams = nGrams("best trees for the north", 2);
    expect(grams).toContain("best trees");
    expect(grams).not.toContain("trees for");
    expect(grams).not.toContain("the north");
  });

  it("returns nothing when the token stream is shorter than n", () => {
    expect(nGrams("trees", 3)).toEqual([]);
  });
});

describe("phraseSet", () => {
  it("collects unigrams plus 2- and 3-grams", () => {
    const phrases = phraseSet("cold hardy trees");
    expect(phrases.has("cold")).toBe(true);
    expect(phrases.has("cold hardy")).toBe(true);
    expect(phrases.has("cold hardy trees")).toBe(true);
  });

  it("is a set, so repetition never inflates a document's contribution", () => {
    const phrases = phraseSet("zone zone zone");
    expect([...phrases].filter((p) => p === "zone")).toHaveLength(1);
  });
});

describe("containsPhrase", () => {
  it("matches on whole tokens only", () => {
    expect(containsPhrase("hardiness zone 3", "zone")).toBe(true);
    // The bug this guards: a substring test would match "zone" inside "ozone".
    expect(containsPhrase("ozone layer", "zone")).toBe(false);
  });

  it("matches multi-word phrases across normalization", () => {
    expect(containsPhrase("Cold-Hardy Trees", "cold hardy")).toBe(true);
  });

  it("is false for an empty phrase", () => {
    expect(containsPhrase("anything", "  ")).toBe(false);
  });
});

describe("documentFrequency", () => {
  it("counts documents containing a phrase, not occurrences", () => {
    const counts = documentFrequency([
      phraseSet("cold hardy trees cold hardy"),
      phraseSet("cold hardy shrubs"),
      phraseSet("warm climate palms"),
    ]);
    expect(counts.get("cold hardy")).toBe(2);
    expect(counts.get("palms")).toBe(1);
  });

  it("sorts by count desc then alphabetically, so runs stay diffable", () => {
    const counts = documentFrequency([
      phraseSet("zebra apple"),
      phraseSet("zebra apple"),
      phraseSet("mango"),
    ]);
    const keys = [...counts.keys()];
    expect(keys.indexOf("apple")).toBeLessThan(keys.indexOf("zebra"));
    expect(keys.indexOf("zebra")).toBeLessThan(keys.indexOf("mango"));
  });
});

describe("dropRedundantSubPhrases", () => {
  it("keeps only the longest phrase when counts are identical", () => {
    const counts = documentFrequency([
      phraseSet("cold hardy trees"),
      phraseSet("cold hardy trees"),
    ]);
    const kept = [...dropRedundantSubPhrases(counts).keys()];
    expect(kept).toContain("cold hardy trees");
    expect(kept).not.toContain("cold hardy");
    expect(kept).not.toContain("cold");
  });

  it("keeps a shorter phrase that is genuinely more common", () => {
    // "zone" appears in both documents; "zone 3 planting" in only one. The
    // differing counts mean both are real facts, so the shorter one survives
    // even though a longer phrase contains it.
    const counts = documentFrequency([
      phraseSet("zone 3 planting"),
      phraseSet("zone planting"),
    ]);
    const kept = dropRedundantSubPhrases(counts);
    expect(kept.get("zone")).toBe(2);
    expect(kept.get("zone 3 planting")).toBe(1);
    // "zone 3" is a 1-count sub-phrase of a 1-count phrase — nothing is lost.
    expect(kept.has("zone 3")).toBe(false);
  });

  it("does not treat a word as contained in an unrelated longer word", () => {
    const counts = new Map([
      ["zone", 3],
      ["ozone layer", 3],
    ]);
    const kept = [...dropRedundantSubPhrases(counts).keys()];
    expect(kept).toContain("zone");
  });

  it("preserves the count-desc, then alphabetical ordering", () => {
    const counts = new Map([
      ["apple", 1],
      ["banana", 5],
      ["cherry", 5],
    ]);
    expect([...dropRedundantSubPhrases(counts).keys()]).toEqual([
      "banana",
      "cherry",
      "apple",
    ]);
  });
});

describe("properNounPhrases", () => {
  it("captures mid-sentence capitalized runs", () => {
    const nouns = properNounPhrases("We planted American Larch last spring.");
    expect(nouns.has("american larch")).toBe(true);
  });

  it("ignores sentence-initial capitalization, which carries no signal", () => {
    const nouns = properNounPhrases("Trees grow slowly.");
    expect(nouns.has("trees")).toBe(false);
  });
});

describe("isQuestion", () => {
  it("recognizes interrogative openers and trailing question marks", () => {
    expect(isQuestion("How fast do trees grow")).toBe(true);
    expect(isQuestion("Zone 3 varieties?")).toBe(true);
    expect(isQuestion("Planting Time")).toBe(false);
  });
});

describe("median / spread", () => {
  it("returns an observed value for even-length samples", () => {
    // Lower median: 2, never the synthetic 2.5.
    expect(median([1, 2, 3, 4])).toBe(2);
  });

  it("is all-zero for an empty sample rather than NaN", () => {
    expect(spread([])).toEqual({ min: 0, median: 0, max: 0 });
  });

  it("reports min/median/max together", () => {
    expect(spread([10, 30, 20])).toEqual({ min: 10, median: 20, max: 30 });
  });
});

describe("wordCount / contentHash", () => {
  it("counts normalized tokens", () => {
    expect(wordCount("The cold-hardy trees!")).toBe(4);
  });

  it("is stable across formatting-only changes", () => {
    expect(contentHash("Cold  Hardy Trees")).toBe(contentHash("cold hardy trees"));
  });

  it("changes when the words change", () => {
    expect(contentHash("cold hardy trees")).not.toBe(
      contentHash("cold hardy shrubs"),
    );
  });
});

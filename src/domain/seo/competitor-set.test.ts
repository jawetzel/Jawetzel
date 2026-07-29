import { describe, expect, it } from "vitest";
import {
  normalizeKeywords,
  rankCompetitors,
  type CompetitorRow,
  type CompetitorSetObservation,
} from "@/domain/seo/competitor-set";

function row(
  domain: string,
  intersections: number,
  avgPosition: number | null = null,
): CompetitorRow {
  return {
    domain,
    intersections,
    avgPosition,
    medianPosition: null,
    visibility: null,
    estimatedTraffic: null,
  };
}

function observation(
  rows: CompetitorRow[],
  keywords = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
): CompetitorSetObservation {
  return {
    keywords,
    location: "2840",
    capturedAt: "2026-07-28T00:00:00.000Z",
    rows,
  };
}

describe("normalizeKeywords", () => {
  it("trims, lowercases, collapses whitespace and drops blanks", () => {
    expect(
      normalizeKeywords(["  Cold Hardy   Trees ", "", "   ", "ZONE 3"]),
    ).toEqual(["cold hardy trees", "zone 3"]);
  });

  it("de-duplicates case-insensitively while preserving first-seen order", () => {
    expect(
      normalizeKeywords(["beta", "Alpha", "BETA", "alpha ", "gamma"]),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("keeps the keyword string stable so routing history can join on it", () => {
    // The backlog is set math over (tag, page, keyword). Two spellings of one
    // keyword would silently split that history, so normalization is the
    // guarantee that makes it computable.
    expect(normalizeKeywords(["Cold Hardy Trees"])).toEqual(
      normalizeKeywords(["cold hardy trees"]),
    );
  });
});

describe("rankCompetitors", () => {
  const base = {
    ourDomain: "weekendplant.com",
    minShare: 0.1,
    limit: 10,
  };

  it("excludes our own domain, however it is spelled", () => {
    const ranked = rankCompetitors({
      ...base,
      observation: observation([
        row("www.weekendplant.com", 9),
        row("thespruce.com", 8),
      ]),
    });
    expect(ranked.map((r) => r.domain)).toEqual(["thespruce.com"]);
  });

  it("sorts by intersections, then by average position", () => {
    const ranked = rankCompetitors({
      ...base,
      observation: observation([
        row("b.com", 5, 12),
        row("a.com", 5, 4),
        row("c.com", 9, 30),
      ]),
    });
    expect(ranked.map((r) => r.domain)).toEqual(["c.com", "a.com", "b.com"]);
  });

  it("treats a missing average position as weakest, not strongest", () => {
    // `null` means "we don't know". Sorting it first would promote the domain
    // we know least about above one we measured.
    const ranked = rankCompetitors({
      ...base,
      observation: observation([row("unknown.com", 5, null), row("known.com", 5, 40)]),
    });
    expect(ranked.map((r) => r.domain)).toEqual(["known.com", "unknown.com"]);
  });

  it("drops the long tail below minShare", () => {
    const ranked = rankCompetitors({
      ...base,
      minShare: 0.3,
      observation: observation([row("broad.com", 6), row("narrow.com", 2)]),
    });
    expect(ranked.map((r) => r.domain)).toEqual(["broad.com"]);
  });

  it("reports share against the submitted keyword count", () => {
    const [first] = rankCompetitors({
      ...base,
      observation: observation([row("x.com", 4)]),
    });
    expect(first.share).toBeCloseTo(0.4);
  });

  it("applies the limit after ranking, not before", () => {
    const ranked = rankCompetitors({
      ...base,
      limit: 2,
      observation: observation([row("c.com", 3), row("a.com", 9), row("b.com", 6)]),
    });
    expect(ranked.map((r) => r.domain)).toEqual(["a.com", "b.com"]);
  });

  it("orders identical rows by domain so runs stay diffable", () => {
    const ranked = rankCompetitors({
      ...base,
      observation: observation([row("z.com", 5, 10), row("a.com", 5, 10)]),
    });
    expect(ranked.map((r) => r.domain)).toEqual(["a.com", "z.com"]);
  });

  it("returns nothing when no keywords were submitted", () => {
    expect(
      rankCompetitors({ ...base, observation: observation([row("a.com", 3)], []) }),
    ).toEqual([]);
  });
});

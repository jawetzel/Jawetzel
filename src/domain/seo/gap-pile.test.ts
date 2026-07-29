import { describe, expect, it } from "vitest";
import {
  isStrikingDistance,
  merge,
  rankPile,
  toGapRows,
  toImproveRows,
  type CompetitorGapRow,
  type GapKeyword,
  type OwnRankingRow,
} from "@/domain/seo/gap-pile";

const AT = "2026-07-28T00:00:00.000Z";

function own(
  keyword: string,
  position: number,
  overrides: Partial<OwnRankingRow> = {},
): OwnRankingRow {
  return {
    keyword,
    position,
    url: `https://weekendplant.com/${keyword.replace(/\s+/g, "-")}`,
    searchVolume: null,
    cpc: null,
    competition: null,
    difficulty: null,
    intent: null,
    ...overrides,
  };
}

function gap(
  keyword: string,
  position: number,
  overrides: Partial<CompetitorGapRow> = {},
): CompetitorGapRow {
  return {
    keyword,
    position,
    url: null,
    searchVolume: null,
    cpc: null,
    competition: null,
    difficulty: null,
    intent: null,
    ...overrides,
  };
}

function stored(overrides: Partial<GapKeyword> = {}): GapKeyword {
  return {
    tag: "weekendplant",
    keyword: "cold hardy trees",
    location: "2840",
    bucket: "gap",
    status: "new",
    searchVolume: 100,
    cpc: null,
    competition: null,
    difficulty: null,
    intent: null,
    ourPosition: null,
    ourUrl: null,
    competitors: [],
    screening: null,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isStrikingDistance", () => {
  it("spans 5 to 20 inclusive", () => {
    expect(isStrikingDistance(4)).toBe(false);
    expect(isStrikingDistance(5)).toBe(true);
    expect(isStrikingDistance(20)).toBe(true);
    expect(isStrikingDistance(21)).toBe(false);
  });
});

describe("toImproveRows", () => {
  it("keeps only striking-distance rankings and carries our URL", () => {
    const rows = toImproveRows({
      tag: "weekendplant",
      location: "2840",
      observedAt: AT,
      rows: [own("already winning", 2), own("nearly there", 7), own("miles off", 40)],
    });

    expect(rows.map((r) => r.keyword)).toEqual(["nearly there"]);
    expect(rows[0].bucket).toBe("improve");
    expect(rows[0].ourPosition).toBe(7);
    expect(rows[0].ourUrl).toContain("nearly-there");
    expect(rows[0].status).toBe("new");
  });
});

describe("toGapRows", () => {
  it("folds one row per keyword and records every competitor holding it", () => {
    const rows = toGapRows({
      tag: "weekendplant",
      location: "2840",
      observedAt: AT,
      byCompetitor: [
        { domain: "a.com", rows: [gap("zone 3 trees", 4)] },
        { domain: "b.com", rows: [gap("zone 3 trees", 2), gap("only b", 9)] },
      ],
    });

    const shared = rows.find((r) => r.keyword === "zone 3 trees");
    expect(shared?.competitors).toEqual([
      { domain: "b.com", position: 2, url: null },
      { domain: "a.com", position: 4, url: null },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("never lets a null from one competitor overwrite another's real metric", () => {
    // The vendor omits fields per call. Taking the last write would discard
    // volume we already paid to learn.
    const rows = toGapRows({
      tag: "weekendplant",
      location: "2840",
      observedAt: AT,
      byCompetitor: [
        { domain: "a.com", rows: [gap("shared", 4, { searchVolume: 1900 })] },
        { domain: "b.com", rows: [gap("shared", 2, { searchVolume: null })] },
      ],
    });

    expect(rows[0].searchVolume).toBe(1900);
  });

  it("marks every row as a gap with no position of our own", () => {
    const rows = toGapRows({
      tag: "weekendplant",
      location: "2840",
      observedAt: AT,
      byCompetitor: [{ domain: "a.com", rows: [gap("anything", 3)] }],
    });

    expect(rows[0].bucket).toBe("gap");
    expect(rows[0].ourPosition).toBeNull();
  });
});

describe("merge", () => {
  it("refreshes facts but preserves the human's decision", () => {
    // The rule the whole refresh story rests on: re-pulling layer 2 next
    // quarter must not resurrect a keyword someone already threw out.
    const result = merge(
      stored({ status: "rejected" }),
      stored({ status: "new", searchVolume: 2400 }),
    );

    expect(result.status).toBe("rejected");
    expect(result.searchVolume).toBe(2400);
  });

  it("preserves firstSeenAt and advances lastSeenAt", () => {
    const result = merge(
      stored({ firstSeenAt: "2026-01-01T00:00:00.000Z" }),
      stored({ firstSeenAt: AT, lastSeenAt: AT }),
    );

    expect(result.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.lastSeenAt).toBe(AT);
  });

  it("keeps an accepted keyword accepted", () => {
    const result = merge(stored({ status: "accepted" }), stored());
    expect(result.status).toBe("accepted");
  });

  it("preserves a screening a layer-2 refresh knows nothing about", () => {
    const screening = {
      capturedAt: AT,
      weaknessScore: 62,
      facts: {
        resultCount: 10,
        ugcResults: 3,
        directoryResults: 0,
        titleTermCoverage: 0.4,
        distinctDomains: 10,
        knownCompetitors: [],
        features: [],
        ourPosition: null,
      },
    };

    const result = merge(stored({ screening }), stored({ screening: null }));
    expect(result.screening?.weaknessScore).toBe(62);
  });

  it("lets a fresh screening replace the stored one", () => {
    // Layer 3 saves through this same merge. Always preferring the stored
    // screening would silently discard the call it just paid for.
    const facts = {
      resultCount: 10,
      ugcResults: 0,
      directoryResults: 0,
      titleTermCoverage: 1,
      distinctDomains: 10,
      knownCompetitors: [],
      features: [],
      ourPosition: null,
    };

    const result = merge(
      stored({ screening: { capturedAt: AT, weaknessScore: 10, facts } }),
      stored({ screening: { capturedAt: AT, weaknessScore: 88, facts } }),
    );
    expect(result.screening?.weaknessScore).toBe(88);
  });
});

describe("rankPile", () => {
  it("puts improve rows first — we already have the page", () => {
    const ranked = rankPile([
      stored({ keyword: "a gap", bucket: "gap", searchVolume: 9000 }),
      stored({ keyword: "an improve", bucket: "improve", searchVolume: 10 }),
    ]);
    expect(ranked.map((r) => r.keyword)).toEqual(["an improve", "a gap"]);
  });

  it("prefers keywords more competitors hold", () => {
    const ranked = rankPile([
      stored({
        keyword: "one holder",
        competitors: [{ domain: "a.com", position: 1, url: null }],
        searchVolume: 5000,
      }),
      stored({
        keyword: "three holders",
        competitors: [
          { domain: "a.com", position: 3, url: null },
          { domain: "b.com", position: 4, url: null },
          { domain: "c.com", position: 5, url: null },
        ],
        searchVolume: 100,
      }),
    ]);
    expect(ranked[0].keyword).toBe("three holders");
  });

  it("treats unknown difficulty as hardest rather than easiest", () => {
    const ranked = rankPile([
      stored({ keyword: "unknown", difficulty: null, searchVolume: 100 }),
      stored({ keyword: "known hard", difficulty: 90, searchVolume: 100 }),
    ]);
    expect(ranked.map((r) => r.keyword)).toEqual(["known hard", "unknown"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  selectCompetitorQueries,
  type PageTopicSource,
  type RankedKeywordRow,
  type RankedKeywordsObservation,
} from "./competitor-queries";

/** A page about cold-hardy trees — the relevance yardstick for every test. */
const PAGE: PageTopicSource = {
  title: "Trees of the North",
  metaDescription: "Cold hardy trees for northern gardens.",
  h1: ["Trees of the North"],
  headings: [{ text: "Choosing a Planting Site" }, { text: "Hardiness Zones" }],
  text: "Hardy trees survive winter. Zone 3 gardens need cold hardy varieties.",
};

const row = (
  keyword: string,
  position: number,
  overrides: Partial<RankedKeywordRow> = {},
): RankedKeywordRow => ({
  keyword,
  position,
  url: null,
  searchVolume: 1000,
  cpc: null,
  competition: null,
  difficulty: 30,
  intent: "informational",
  ...overrides,
});

const observation = (
  target: string,
  rows: RankedKeywordRow[],
): RankedKeywordsObservation => ({
  target,
  location: "2840",
  capturedAt: "2026-07-23T00:00:00.000Z",
  totalCount: rows.length,
  rows,
});

function select(
  observations: RankedKeywordsObservation[],
  overrides: Partial<Parameters<typeof selectCompetitorQueries>[0]> = {},
) {
  return selectCompetitorQueries({
    observations,
    page: PAGE,
    excludeQueries: [],
    maxSuggestions: 10,
    ...overrides,
  });
}

describe("selectCompetitorQueries", () => {
  it("pools rows across competitors and counts who ranks where", () => {
    const result = select([
      observation("arbor-site.com", [row("cold hardy trees", 3)]),
      observation("treenursery.com", [row("Cold Hardy Trees", 7)]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      query: "cold hardy trees",
      competitorCount: 2,
      bestPosition: 3,
      domains: ["arbor-site.com", "treenursery.com"],
    });
  });

  it("only counts page-one positions — rank 11+ is not 'doing well'", () => {
    const result = select([
      observation("arbor-site.com", [
        row("cold hardy trees", 11),
        row("hardy trees zone 3", 4),
      ]),
    ]);

    expect(result.map((s) => s.query)).toEqual(["hardy trees zone 3"]);
  });

  it("drops a competitor's own brand queries without touching generic phrases", () => {
    const result = select([
      observation("fast-growing-trees.com", [
        // Glued brand token → navigational, dropped.
        row("fastgrowingtrees coupon code", 1),
        // The same words spelled apart are a generic query and must survive.
        row("cold hardy trees fast growing", 5),
      ]),
    ]);

    expect(result.map((s) => s.query)).toEqual([
      "cold hardy trees fast growing",
    ]);
  });

  it("drops off-topic queries the page shares fewer than half its words with", () => {
    const result = select([
      observation("arbor-site.com", [
        // 1 of 3 content words ("trees") on the page — a different product line.
        row("palm trees florida delivery", 2),
        // 2 of 3 on the page — an adjacent, coverable topic.
        row("cold hardy shrubs", 2),
      ]),
    ]);

    expect(result.map((s) => s.query)).toEqual(["cold hardy shrubs"]);
  });

  it("never re-suggests an excluded (already analyzed) query", () => {
    const result = select(
      [observation("arbor-site.com", [row("Cold Hardy Trees", 2)])],
      { excludeQueries: ["cold hardy trees"] },
    );
    expect(result).toEqual([]);
  });

  it("ranks breadth and demand above a single competitor's fluke", () => {
    const shared = [
      observation("a.com", [
        row("cold hardy trees", 2, { searchVolume: 4000 }),
        row("hardy trees zone 3", 1, { searchVolume: 100 }),
      ]),
      observation("b.com", [row("cold hardy trees", 5, { searchVolume: 4000 })]),
      observation("c.com", [row("cold hardy trees", 8, { searchVolume: 4000 })]),
    ];
    const result = select(shared);

    expect(result[0].query).toBe("cold hardy trees");
    expect(result[0].competitorCount).toBe(3);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("caps at maxSuggestions and returns [] with nothing to pool", () => {
    const many = observation(
      "arbor-site.com",
      ["cold hardy trees", "hardy trees", "trees zone 3", "cold hardy zone"].map(
        (q, i) => row(q, i + 1),
      ),
    );
    expect(select([many], { maxSuggestions: 2 })).toHaveLength(2);
    expect(select([])).toEqual([]);
  });

  it("keeps null metrics null — an unpriced query is unknown, not zero", () => {
    const result = select([
      observation("arbor-site.com", [
        row("cold hardy trees", 2, { searchVolume: null, difficulty: null }),
      ]),
    ]);

    expect(result[0].searchVolume).toBeNull();
    expect(result[0].difficulty).toBeNull();
    // Demand contributes 0, winnability its neutral 0.5, breadth 1 of 1.
    expect(result[0].score).toBe(Math.round(100 * (0.3 * 0.5 + 0.25)));
  });
});

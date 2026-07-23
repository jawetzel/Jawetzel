import { describe, it, expect } from "vitest";
import { rankQueryCandidates } from "./query-candidates";

const metric = (
  query: string,
  searchVolume: number | null,
  difficulty: number | null,
  intent: string | null = null,
) => ({ query, searchVolume, difficulty, intent });

describe("rankQueryCandidates", () => {
  it("floats a winnable, in-demand query above a harder one with similar volume", () => {
    const ranked = rankQueryCandidates({
      candidates: ["baton rouge software developer", "legacy system modernization"],
      metrics: [
        metric("baton rouge software developer", 210, 28),
        metric("legacy system modernization", 260, 41),
      ],
    });
    expect(ranked[0].query).toBe("baton rouge software developer");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("marks a candidate with no demand data ungrounded and scores its demand at zero", () => {
    const ranked = rankQueryCandidates({
      candidates: ["a query nobody priced"],
      metrics: [],
    });
    expect(ranked[0].grounded).toBe(false);
    expect(ranked[0].searchVolume).toBeNull();
    // Demand term is 0; only the neutral winnability term survives.
    expect(ranked[0].score).toBe(20);
  });

  it("ranks a grounded, high-volume query above an ungrounded guess", () => {
    const ranked = rankQueryCandidates({
      candidates: ["unpriced guess", "real demand"],
      metrics: [metric("real demand", 1200, 30)],
    });
    expect(ranked[0].query).toBe("real demand");
    expect(ranked[0].grounded).toBe(true);
  });

  it("dedupes case-insensitively and matches metrics regardless of casing", () => {
    const ranked = rankQueryCandidates({
      candidates: ["Cold Hardy Trees", "cold hardy trees"],
      metrics: [metric("cold hardy trees", 400, 25, "informational")],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].intent).toBe("informational");
    expect(ranked[0].grounded).toBe(true);
  });

  it("drops blank candidates", () => {
    const ranked = rankQueryCandidates({
      candidates: ["  ", "", "real one"],
      metrics: [],
    });
    expect(ranked.map((r) => r.query)).toEqual(["real one"]);
  });
});

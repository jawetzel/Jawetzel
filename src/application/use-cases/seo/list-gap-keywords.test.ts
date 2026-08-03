import { describe, expect, it } from "vitest";
import { type GapKeyword } from "@/domain/seo/gap-pile";
import { InMemorySeoGapRepository } from "@/application/ports/seo-gap-repository.fake";
import { createListGapKeywords } from "@/application/use-cases/seo/list-gap-keywords";

const AT = "2026-07-28T00:00:00.000Z";

function row(overrides: Partial<GapKeyword> = {}): GapKeyword {
  return {
    tag: "ohmycrafty",
    keyword: "embroidery digitizing",
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
    competitors: [{ domain: "a.com", position: 3, url: null }],
    screening: null,
    firstSeenAt: AT,
    lastSeenAt: AT,
    ...overrides,
  };
}

/** A pile the size the real ones actually are. */
function pile(count: number, overrides: (i: number) => Partial<GapKeyword>) {
  return Array.from({ length: count }, (_, i) =>
    row({ keyword: `kw ${String(i).padStart(4, "0")}`, ...overrides(i) }),
  );
}

function subject(seed: GapKeyword[]) {
  return createListGapKeywords({ gaps: new InMemorySeoGapRepository(seed) });
}

describe("ListGapKeywords", () => {
  it("returns the whole pile, not a 200-row prefix of it", async () => {
    // The bug this replaces: the default capped the read at 200 across *both*
    // buckets, so a thousand-keyword property showed 200 rows while its own
    // status counters — read straight from the store — said otherwise.
    const result = await subject(
      pile(1000, (i) => ({ searchVolume: i, bucket: i % 2 ? "gap" : "improve" })),
    ).execute({ tag: "ohmycrafty" });

    expect(result.rows).toHaveLength(1000);
    expect(result.total).toBe(1000);
  });

  it("counts every status across the pile, not across the rows returned", async () => {
    const result = await subject([
      ...pile(3, () => ({ status: "accepted" as const })),
      ...pile(5, (i) => ({ keyword: `r ${i}`, status: "rejected" as const })),
    ]).execute({ tag: "ohmycrafty" });

    expect(result.counts).toEqual({ new: 0, accepted: 3, rejected: 5 });
    expect(result.total).toBe(8);
  });

  it("includes rejected rows so the screen can reveal them without a refetch", async () => {
    const result = await subject([
      row({ keyword: "kept", status: "new" }),
      row({ keyword: "thrown out", status: "rejected" }),
    ]).execute({ tag: "ohmycrafty" });

    expect(result.rows.map((r) => r.keyword).sort()).toEqual([
      "kept",
      "thrown out",
    ]);
  });

  it("ranks by biggest win by default", async () => {
    const result = await subject([
      row({ keyword: "crowded but tiny", searchVolume: 10, difficulty: 1 }),
      row({ keyword: "huge", searchVolume: 40_000, difficulty: 40 }),
    ]).execute({ tag: "ohmycrafty" });

    expect(result.rows[0].keyword).toBe("huge");
    expect(result.rows[0].opportunityScore).toBeGreaterThan(0);
  });

  it("honours an explicit volume sort", async () => {
    const result = await subject([
      row({ keyword: "easy", searchVolume: 500, difficulty: 1 }),
      row({ keyword: "brutal", searchVolume: 9000, difficulty: 99 }),
    ]).execute({ tag: "ohmycrafty", sort: "volume" });

    expect(result.rows.map((r) => r.keyword)).toEqual(["brutal", "easy"]);
  });

  it("drops the least in-demand rows when a limit truncates", async () => {
    // The ordering guarantee on the port. Truncating an unordered read would
    // hand back an arbitrary slice that the ranking below then dresses up as
    // "the top of the pile".
    const result = await subject(
      pile(50, (i) => ({ searchVolume: i * 100 })),
    ).execute({ tag: "ohmycrafty", limit: 5 });

    expect(result.rows).toHaveLength(5);
    expect(result.total).toBe(50);
    expect(result.rows.map((r) => r.searchVolume)).toEqual([
      4900, 4800, 4700, 4600, 4500,
    ]);
  });

  it("scopes to one tag", async () => {
    const result = await subject([
      row({ tag: "ohmycrafty" }),
      row({ tag: "weekendplant", keyword: "cold hardy trees" }),
    ]).execute({ tag: "ohmycrafty" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tag).toBe("ohmycrafty");
  });
});

import { describe, expect, it } from "vitest";
import {
  backlogCoverage,
  computeBacklog,
  pageKey,
  preRoute,
  reconcileVerdicts,
  type Routing,
} from "@/domain/seo/routing";
import { type GapKeyword } from "@/domain/seo/gap-pile";

function row(overrides: Partial<GapKeyword> = {}): GapKeyword {
  return {
    tag: "weekendplant",
    keyword: "cold hardy trees",
    location: "2840",
    bucket: "gap",
    status: "accepted",
    searchVolume: null,
    cpc: null,
    competition: null,
    difficulty: null,
    intent: null,
    ourPosition: null,
    ourUrl: null,
    competitors: [],
    screening: null,
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function routing(overrides: Partial<Routing> = {}): Routing {
  return {
    tag: "weekendplant",
    pageUrl: "https://weekendplant.com/a",
    keyword: "cold hardy trees",
    verdict: "enrich",
    rationale: null,
    overridden: false,
    routedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("pageKey", () => {
  it("collapses trailing slashes, query strings and fragments", () => {
    // All four describe the same page. Letting them through would split one
    // page's routing history across four keys and break the backlog.
    const variants = [
      "https://weekendplant.com/guide/",
      "https://weekendplant.com/guide",
      "https://weekendplant.com/guide?utm_source=x",
      "https://WeekendPlant.com/guide#intro",
    ];
    const keys = new Set(variants.map(pageKey));
    expect(keys.size).toBe(1);
  });

  it("falls back to the trimmed string for an unparseable URL", () => {
    expect(pageKey("  Not A URL ")).toBe("not a url");
  });
});

describe("preRoute", () => {
  it("decides improve without a model when the URL is this page", () => {
    const split = preRoute({
      pageUrl: "https://weekendplant.com/a",
      rows: [
        row({
          keyword: "nearly there",
          bucket: "improve",
          ourUrl: "https://weekendplant.com/a/",
        }),
      ],
    });

    expect(split.decided).toEqual([
      { keyword: "nearly there", verdict: "improve" },
    ]);
    expect(split.needsJudgment).toHaveLength(0);
  });

  it("excludes improve rows owned by another of our pages", () => {
    // A keyword another page already owns is not a candidate for this one;
    // claiming it here would let one run absorb another page's work.
    const split = preRoute({
      pageUrl: "https://weekendplant.com/a",
      rows: [
        row({
          keyword: "elsewhere",
          bucket: "improve",
          ourUrl: "https://weekendplant.com/b",
        }),
      ],
    });

    expect(split.decided).toHaveLength(0);
    expect(split.needsJudgment).toHaveLength(0);
    expect(split.ownedElsewhere).toBe(1);
  });

  it("sends gap rows on for judgment", () => {
    const split = preRoute({
      pageUrl: "https://weekendplant.com/a",
      rows: [row({ keyword: "a gap" })],
    });

    expect(split.needsJudgment.map((r) => r.keyword)).toEqual(["a gap"]);
  });
});

describe("reconcileVerdicts", () => {
  it("keeps verdicts for keywords it was asked about", () => {
    const result = reconcileVerdicts({
      asked: ["one", "two"],
      returned: [
        { keyword: "one", verdict: "enrich", why: "same subject" },
        { keyword: "two", verdict: "create" },
      ],
    });

    expect(result).toEqual([
      { keyword: "one", verdict: "enrich", rationale: "same subject" },
      { keyword: "two", verdict: "create", rationale: null },
    ]);
  });

  it("defaults a skipped keyword to create, the conservative answer", () => {
    // Parking a keyword in the backlog is recoverable; asserting a page should
    // cover something nobody judged is not.
    const result = reconcileVerdicts({
      asked: ["judged", "skipped"],
      returned: [{ keyword: "judged", verdict: "enrich" }],
    });

    expect(result[1]).toEqual({
      keyword: "skipped",
      verdict: "create",
      rationale: null,
    });
  });

  it("drops keywords the model invented", () => {
    const result = reconcileVerdicts({
      asked: ["real"],
      returned: [
        { keyword: "real", verdict: "enrich" },
        { keyword: "hallucinated", verdict: "enrich" },
      ],
    });

    expect(result.map((r) => r.keyword)).toEqual(["real"]);
  });

  it("treats an unknown verdict as no verdict", () => {
    const result = reconcileVerdicts({
      asked: ["one"],
      returned: [{ keyword: "one", verdict: "maybe-ish" }],
    });

    expect(result[0].verdict).toBe("create");
  });

  it("returns exactly one row per asked keyword, in order", () => {
    const result = reconcileVerdicts({
      asked: ["a", "b", "c"],
      returned: [
        { keyword: "c", verdict: "enrich" },
        { keyword: "c", verdict: "create" },
      ],
    });

    expect(result.map((r) => r.keyword)).toEqual(["a", "b", "c"]);
    // First verdict for a keyword wins; the duplicate is ignored.
    expect(result[2].verdict).toBe("enrich");
  });
});

describe("computeBacklog", () => {
  it("excludes keywords any page claimed as improve or enrich", () => {
    const backlog = computeBacklog({
      accepted: [row({ keyword: "claimed" }), row({ keyword: "unclaimed" })],
      routings: [routing({ keyword: "claimed", verdict: "enrich" })],
    });

    expect(backlog.map((r) => r.keyword)).toEqual(["unclaimed"]);
  });

  it("does not treat a create verdict as a claim", () => {
    // One page declining a keyword is exactly what the backlog is made of.
    const backlog = computeBacklog({
      accepted: [row({ keyword: "declined" })],
      routings: [routing({ keyword: "declined", verdict: "create" })],
    });

    expect(backlog.map((r) => r.keyword)).toEqual(["declined"]);
  });

  it("counts a claim from any page, not only the most recent", () => {
    const backlog = computeBacklog({
      accepted: [row({ keyword: "shared" })],
      routings: [
        routing({ keyword: "shared", pageUrl: "https://x.com/a", verdict: "create" }),
        routing({ keyword: "shared", pageUrl: "https://x.com/b", verdict: "enrich" }),
      ],
    });

    expect(backlog).toHaveLength(0);
  });
});

describe("backlogCoverage", () => {
  it("reports how many distinct pages have been routed", () => {
    // The figure the list has to ship with: after three pages the residue is
    // mostly "we haven't looked yet", not a finding.
    const coverage = backlogCoverage([
      routing({ pageUrl: "https://x.com/a", keyword: "one", verdict: "enrich" }),
      routing({ pageUrl: "https://x.com/a", keyword: "two", verdict: "create" }),
      routing({ pageUrl: "https://x.com/b", keyword: "one", verdict: "create" }),
    ]);

    expect(coverage).toEqual({ pagesRouted: 2, keywordsClaimed: 1 });
  });
});

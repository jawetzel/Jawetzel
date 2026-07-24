import { describe, it, expect } from "vitest";
import { isOk, isErr } from "@/domain/shared/result";
import { type SerpObservation } from "@/domain/seo/serp-facts";
import {
  type RankedKeywordRow,
  type RankedKeywordsObservation,
} from "@/domain/seo/competitor-queries";
import { FakePageCrawlGateway } from "@/application/ports/page-crawl-gateway.fake";
import { FakeSerpGateway } from "@/application/ports/serp-gateway.fake";
import { FakeRankedKeywordsGateway } from "@/application/ports/ranked-keywords-gateway.fake";
import { FakeSeoCorpusRepository } from "@/application/ports/seo-corpus-repository.fake";
import {
  createDiscoverCompetitorQueries,
  type DiscoverCompetitorQueriesInput,
} from "./discover-competitor-queries";

const NOW = () => new Date("2026-07-23T12:00:00.000Z");

const OUR_URL = "https://weekendplant.com/trees";
const OUR_HTML = `<html><head><title>Trees of the North</title>
  <meta name="description" content="Cold hardy trees for northern gardens."></head>
  <body><main><h1>Trees of the North</h1><h2>Hardiness Zones</h2>
  <p>Hardy trees survive winter. Zone 3 gardens need cold hardy varieties.</p>
  </main></body></html>`;

/** The SERP for the target query: us at #1, three competitors, one duplicated. */
const SERP: SerpObservation = {
  query: "cold hardy trees",
  location: "2840",
  capturedAt: "2026-07-23T11:00:00.000Z",
  results: [
    { position: 1, url: OUR_URL, domain: "weekendplant.com", title: "ours", description: null },
    { position: 2, url: "https://arbor-site.com/a", domain: "arbor-site.com", title: "a", description: null },
    { position: 3, url: "https://treenursery.com/b", domain: "treenursery.com", title: "b", description: null },
    { position: 4, url: "https://arbor-site.com/c", domain: "arbor-site.com", title: "c", description: null },
    { position: 5, url: "https://gardenblog.com/d", domain: "gardenblog.com", title: "d", description: null },
  ],
  features: [],
  paaQuestions: [],
};

const row = (
  keyword: string,
  position: number,
  overrides: Partial<RankedKeywordRow> = {},
): RankedKeywordRow => ({
  keyword,
  position,
  url: null,
  searchVolume: 800,
  cpc: null,
  competition: null,
  difficulty: 25,
  intent: "informational",
  ...overrides,
});

const rankedObs = (
  target: string,
  rows: RankedKeywordRow[],
  capturedAt = "2026-07-20T00:00:00.000Z",
): RankedKeywordsObservation => ({
  target,
  location: "2840",
  capturedAt,
  totalCount: 500,
  rows,
});

const RANKED_BY_TARGET = {
  "arbor-site.com": rankedObs("arbor-site.com", [
    row("cold hardy trees", 2), // the target query itself — never re-suggested
    row("hardy trees zone 3", 4),
    row("cold hardy shrubs", 6),
  ]),
  "treenursery.com": rankedObs("treenursery.com", [
    row("hardy trees zone 3", 7),
  ]),
  "gardenblog.com": rankedObs("gardenblog.com", [
    row("lawn mower repair guide", 3), // off-topic for this page — filtered
  ]),
};

function input(
  overrides: Partial<DiscoverCompetitorQueriesInput> = {},
): DiscoverCompetitorQueriesInput {
  return {
    url: OUR_URL,
    targetQuery: "cold hardy trees",
    locationCode: 2840,
    languageCode: "en",
    maxCompetitors: 4,
    maxSuggestions: 10,
    excludeQueries: [],
    maxSnapshotAgeDays: 7,
    ...overrides,
  };
}

function deps(
  overrides: Partial<
    Parameters<typeof createDiscoverCompetitorQueries>[0]
  > = {},
) {
  return {
    crawler: new FakePageCrawlGateway({ [OUR_URL]: OUR_HTML }),
    serp: new FakeSerpGateway(SERP),
    rankedKeywords: new FakeRankedKeywordsGateway(RANKED_BY_TARGET),
    corpus: new FakeSeoCorpusRepository({}, NOW),
    now: NOW,
    ...overrides,
  };
}

describe("DiscoverCompetitorQueries", () => {
  it("pulls distinct competitors off the SERP and suggests what they win", async () => {
    const corpus = new FakeSeoCorpusRepository({}, NOW);
    const result = await createDiscoverCompetitorQueries(
      deps({ corpus }),
    ).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    // Our own domain is excluded; arbor-site appears once despite two results.
    expect(result.value.competitors.map((c) => c.domain)).toEqual([
      "arbor-site.com",
      "treenursery.com",
      "gardenblog.com",
    ]);
    expect(result.value.competitors[0].serpPosition).toBe(2);

    // The target query itself and the off-topic row are gone; the two-domain
    // query outranks the one-domain query.
    expect(result.value.suggestions.map((s) => s.query)).toEqual([
      "hardy trees zone 3",
      "cold hardy shrubs",
    ]);
    expect(result.value.suggestions[0].competitorCount).toBe(2);

    // Flywheel writes: the live SERP and all three pulls landed in the corpus.
    expect(corpus.snapshots).toHaveLength(1);
    expect(corpus.rankedKeywords).toHaveLength(3);
    expect(result.value.sample).toMatchObject({
      serpFromCorpus: false,
      competitorsRequested: 3,
      competitorsWithData: 3,
    });
  });

  it("serves both the SERP and rankings from the corpus without paid calls", async () => {
    const serp = new FakeSerpGateway("UPSTREAM_ERROR");
    const ranked = new FakeRankedKeywordsGateway({});
    const corpus = new FakeSeoCorpusRepository(
      {
        snapshots: [SERP],
        rankedKeywords: Object.values(RANKED_BY_TARGET),
      },
      NOW,
    );
    const result = await createDiscoverCompetitorQueries(
      deps({ serp, rankedKeywords: ranked, corpus }),
    ).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    expect(serp.requests).toHaveLength(0);
    expect(ranked.requests).toHaveLength(0);
    expect(result.value.sample.serpFromCorpus).toBe(true);
    expect(result.value.competitors.every((c) => c.fromCorpus)).toBe(true);
    expect(result.value.suggestions.length).toBeGreaterThan(0);
  });

  it("caps at maxCompetitors, taking the best-positioned domains", async () => {
    const result = await createDiscoverCompetitorQueries(deps()).execute(
      input({ maxCompetitors: 2 }),
    );
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.competitors.map((c) => c.domain)).toEqual([
      "arbor-site.com",
      "treenursery.com",
    ]);
  });

  it("keeps going when one domain's pull fails, and says which", async () => {
    const ranked = new FakeRankedKeywordsGateway({
      ...RANKED_BY_TARGET,
      "treenursery.com": "UPSTREAM_ERROR",
    });
    const result = await createDiscoverCompetitorQueries(
      deps({ rankedKeywords: ranked }),
    ).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    const failed = result.value.competitors.find(
      (c) => c.domain === "treenursery.com",
    );
    expect(failed).toMatchObject({ failed: true, keywordsSampled: 0 });
    expect(result.value.sample.competitorsWithData).toBe(2);
    // Down to one ranking domain, but the suggestion survives.
    expect(
      result.value.suggestions.map((s) => s.query),
    ).toContain("hardy trees zone 3");
  });

  it("honors excludeQueries on top of the target query", async () => {
    const result = await createDiscoverCompetitorQueries(deps()).execute(
      input({ excludeQueries: ["Hardy Trees Zone 3"] }),
    );
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.suggestions.map((s) => s.query)).toEqual([
      "cold hardy shrubs",
    ]);
  });

  it("distinguishes 'nothing came back' from 'provider unconfigured'", async () => {
    const allDown = await createDiscoverCompetitorQueries(
      deps({
        rankedKeywords: new FakeRankedKeywordsGateway({
          "arbor-site.com": "UPSTREAM_ERROR",
          "treenursery.com": "UPSTREAM_ERROR",
          "gardenblog.com": "UPSTREAM_ERROR",
        }),
      }),
    ).execute(input());
    expect(isErr(allDown) && allDown.error).toBe("NO_COMPETITOR_DATA");

    const unconfigured = await createDiscoverCompetitorQueries(
      deps({
        rankedKeywords: new FakeRankedKeywordsGateway({
          "arbor-site.com": "NOT_CONFIGURED",
          "treenursery.com": "NOT_CONFIGURED",
          "gardenblog.com": "NOT_CONFIGURED",
        }),
      }),
    ).execute(input());
    expect(isErr(unconfigured) && unconfigured.error).toBe(
      "RANKED_KEYWORDS_NOT_CONFIGURED",
    );
  });

  it("maps upstream failures the same way the analyzer does", async () => {
    const unreachable = await createDiscoverCompetitorQueries(
      deps({ crawler: new FakePageCrawlGateway({}, { [OUR_URL]: "timeout" }) }),
    ).execute(input());
    expect(isErr(unreachable) && unreachable.error).toBe("PAGE_UNREACHABLE");

    const noSerp = await createDiscoverCompetitorQueries(
      deps({ serp: new FakeSerpGateway("NOT_CONFIGURED") }),
    ).execute(input());
    expect(isErr(noSerp) && noSerp.error).toBe("SERP_NOT_CONFIGURED");

    const serpDown = await createDiscoverCompetitorQueries(
      deps({ serp: new FakeSerpGateway("UPSTREAM_ERROR") }),
    ).execute(input());
    expect(isErr(serpDown) && serpDown.error).toBe("SERP_UNAVAILABLE");
  });
});

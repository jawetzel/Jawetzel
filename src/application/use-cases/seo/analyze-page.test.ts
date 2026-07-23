import { describe, it, expect } from "vitest";
import { isOk, isErr } from "@/domain/shared/result";
import { type SerpObservation } from "@/domain/seo/serp-facts";
import { FakePageCrawlGateway } from "@/application/ports/page-crawl-gateway.fake";
import { FakeSerpGateway } from "@/application/ports/serp-gateway.fake";
import { FakeKeywordMetricsGateway } from "@/application/ports/keyword-metrics-gateway.fake";
import { FakeSeoCorpusRepository } from "@/application/ports/seo-corpus-repository.fake";
import { FakeSeoAnalysisRepository } from "@/application/ports/seo-analysis-repository.fake";
import { createAnalyzePage, type AnalyzePageInput } from "./analyze-page";

const OUR_URL = "https://weekendplant.com/trees";
const NOW = new Date("2026-07-22T12:00:00.000Z");

const OUR_HTML = `<html><head><title>Trees of the North</title></head>
  <body><main>
    <h1>Trees of the North</h1>
    <h2>Choosing a Site</h2>
    <p>The hardiness zone matters here.</p>
  </main></body></html>`;

const RIVAL_HTML = `<html><head><title>x</title></head>
  <body><main>
    <h2>Hardiness Zones</h2>
    <p>Paper Birch grows well in cold climates.</p>
    <script type="application/ld+json">{"@type":"ItemList"}</script>
  </main></body></html>`;

const OBSERVATION: SerpObservation = {
  query: "cold hardy trees",
  location: "2840",
  capturedAt: "2026-07-22T09:00:00.000Z",
  features: ["people_also_ask"],
  paaQuestions: ["What trees survive zone 3 winters?"],
  results: [
    {
      position: 1,
      url: "https://a.com/x",
      domain: "a.com",
      title: "23 Cold Hardy Trees for Zone 3",
      description: "Cold hardy varieties by zone.",
    },
    {
      position: 2,
      url: "https://b.com/x",
      domain: "b.com",
      title: "Best Cold Hardy Trees by Zone",
      description: "Cold hardy picks by zone.",
    },
    {
      position: 3,
      url: "https://weekendplant.com/trees",
      domain: "weekendplant.com",
      title: "Trees of the North",
      description: null,
    },
  ],
};

function input(overrides: Partial<AnalyzePageInput> = {}): AnalyzePageInput {
  return {
    url: OUR_URL,
    targetQuery: "cold hardy trees",
    locationCode: 2840,
    languageCode: "en",
    entitySchema: ["hardinessZone", "matureHeight"],
    urgencyTerms: [],
    city: null,
    minShare: 0.3,
    maxSnapshotAgeDays: 7,
    include: [],
    ...overrides,
  };
}

function deps(overrides: Partial<Parameters<typeof createAnalyzePage>[0]> = {}) {
  return {
    crawler: new FakePageCrawlGateway({
      [OUR_URL]: OUR_HTML,
      "https://a.com/x": RIVAL_HTML,
      "https://b.com/x": RIVAL_HTML,
    }),
    serp: new FakeSerpGateway(OBSERVATION),
    keywords: new FakeKeywordMetricsGateway(),
    corpus: new FakeSeoCorpusRepository({}, () => NOW),
    analyses: new FakeSeoAnalysisRepository(),
    now: () => NOW,
    ...overrides,
  };
}

describe("AnalyzePage — the happy path", () => {
  it("returns swaps, thresholds, and the sample it measured", async () => {
    const d = deps();
    const result = await createAnalyzePage(d).execute(input());

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.url).toBe(OUR_URL);
    expect(result.value.query).toBe("cold hardy trees");
    expect(result.value.formulaVersion).toBe("1.0.0");
    expect(result.value.swaps.length).toBeGreaterThan(0);
    expect(result.value.thresholds).toEqual({
      minShare: 0.3,
      maxSnapshotAgeDays: 7,
    });
    expect(result.value.sample).toMatchObject({
      competitors: 2,
      crawled: 2,
      crawlFailures: 0,
      ourPosition: 3,
      serpFromCorpus: false,
    });
  });

  it("excludes our own result from the competitor crawl", async () => {
    const d = deps();
    await createAnalyzePage(d).execute(input());

    const crawler = d.crawler as FakePageCrawlGateway;
    expect(crawler.requested).toEqual([
      OUR_URL,
      "https://a.com/x",
      "https://b.com/x",
    ]);
  });

  it("emits no rationale and no prose suggestion for title or meta", async () => {
    const result = await createAnalyzePage(deps()).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    const title = result.value.swaps.find((s) => s.area === "title");
    expect(title?.suggested).toBeUndefined();
    expect(title?.signals?.examples).toContain("23 Cold Hardy Trees for Zone 3");
  });

  it("omits optional sections unless asked for them", async () => {
    const result = await createAnalyzePage(deps()).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    expect(result.value.history).toBeUndefined();
    expect(result.value.serp).toBeUndefined();
    expect(result.value.facts).toBeUndefined();
    expect(result.value.keywords).toBeUndefined();
    expect(result.value.swaps.every((s) => s.provenance === undefined)).toBe(true);
  });

  it("attaches each requested section", async () => {
    const result = await createAnalyzePage(deps()).execute(
      input({ include: ["provenance", "history", "serp", "facts", "keywords"] }),
    );
    if (!isOk(result)) throw new Error("expected ok");

    expect(result.value.serp?.query).toBe("cold hardy trees");
    expect(result.value.facts?.page.title).toBe("Trees of the North");
    expect(result.value.facts?.delta.missingEntityFields).toEqual(["matureHeight"]);
    expect(result.value.history?.observations).toBe(1);
    expect(result.value.swaps.some((s) => s.provenance !== undefined)).toBe(true);
  });

  it("serializes cleanly — no Sets survive into the response", async () => {
    const result = await createAnalyzePage(deps()).execute(
      input({ include: ["facts", "serp"] }),
    );
    if (!isOk(result)) throw new Error("expected ok");
    // A Set would silently become {} through JSON, so assert the round trip.
    const round = JSON.parse(JSON.stringify(result.value));
    expect(round.facts.page.title).toBe("Trees of the North");
    expect(Array.isArray(round.serp.titleTerms)).toBe(true);
  });
});

describe("AnalyzePage — the corpus (Part 4 spine)", () => {
  it("stores every freshly observed SERP", async () => {
    const d = deps();
    await createAnalyzePage(d).execute(input());

    const corpus = d.corpus as FakeSeoCorpusRepository;
    expect(corpus.snapshots).toHaveLength(1);
    expect(corpus.snapshots[0].query).toBe("cold hardy trees");
  });

  it("reuses a fresh stored snapshot instead of paying for another", async () => {
    const corpus = new FakeSeoCorpusRepository(
      { snapshots: [OBSERVATION] },
      () => NOW,
    );
    const serp = new FakeSerpGateway(OBSERVATION);
    const result = await createAnalyzePage(deps({ corpus, serp })).execute(input());

    if (!isOk(result)) throw new Error("expected ok");
    expect(serp.requests).toEqual([]);
    expect(result.value.sample.serpFromCorpus).toBe(true);
    // Nothing new appended — the stored observation was reused, not re-saved.
    expect(corpus.snapshots).toHaveLength(1);
  });

  it("re-observes when the stored snapshot is older than the window", async () => {
    const corpus = new FakeSeoCorpusRepository(
      {
        snapshots: [
          { ...OBSERVATION, capturedAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
      () => NOW,
    );
    const serp = new FakeSerpGateway(OBSERVATION);
    await createAnalyzePage(deps({ corpus, serp })).execute(input());

    expect(serp.requests).toHaveLength(1);
    expect(corpus.snapshots).toHaveLength(2);
  });

  it("writes a page snapshot the first time it sees a page", async () => {
    const d = deps();
    await createAnalyzePage(d).execute(input());

    const corpus = d.corpus as FakeSeoCorpusRepository;
    expect(corpus.pageSnapshots).toHaveLength(1);
    expect(corpus.pageSnapshots[0]).toMatchObject({
      propertyId: "weekendplant.com",
      url: OUR_URL,
      title: "Trees of the North",
    });
  });

  it("does not re-snapshot a page whose content is unchanged", async () => {
    const d = deps();
    const useCase = createAnalyzePage(d);
    await useCase.execute(input());
    await useCase.execute(input());

    const corpus = d.corpus as FakeSeoCorpusRepository;
    expect(corpus.pageSnapshots).toHaveLength(1);
  });

  it("snapshots again once the content actually changes", async () => {
    const corpus = new FakeSeoCorpusRepository({}, () => NOW);
    await createAnalyzePage(deps({ corpus })).execute(input());
    await createAnalyzePage(
      deps({
        corpus,
        crawler: new FakePageCrawlGateway({
          [OUR_URL]: OUR_HTML.replace("Choosing a Site", "Hardiness Zones"),
          "https://a.com/x": RIVAL_HTML,
          "https://b.com/x": RIVAL_HTML,
        }),
      }),
    ).execute(input());

    expect(corpus.pageSnapshots).toHaveLength(2);
  });
});

describe("AnalyzePage — run history (derived page_analysis)", () => {
  it("persists the run's durable core, not the request-specific includes", async () => {
    const analyses = new FakeSeoAnalysisRepository();
    const result = await createAnalyzePage(deps({ analyses })).execute(
      input({ include: ["serp", "facts"] }),
    );
    if (!isOk(result)) throw new Error("expected ok");

    expect(analyses.saved).toHaveLength(1);
    const saved = analyses.saved[0];
    expect(saved).toMatchObject({
      propertyId: "weekendplant.com",
      url: OUR_URL,
      query: "cold hardy trees",
      location: "2840",
      runAt: NOW.toISOString(),
      formulaVersion: "1.0.0",
    });
    expect(saved.swaps).toEqual(result.value.swaps);
    expect(saved.sample).toEqual(result.value.sample);
    // The stored record carries no include payloads.
    expect(saved).not.toHaveProperty("serp");
    expect(saved).not.toHaveProperty("facts");
  });

  it("still returns a completed analysis when the history write fails", async () => {
    const analyses = new FakeSeoAnalysisRepository();
    analyses.save = async () => {
      throw new Error("mongo down");
    };
    const result = await createAnalyzePage(deps({ analyses })).execute(input());
    // History is derived and disposable — a write failure must not fail the run.
    expect(isOk(result)).toBe(true);
  });
});

describe("AnalyzePage — keyword metrics", () => {
  it("batches the target query together with recommended title terms", async () => {
    const keywords = new FakeKeywordMetricsGateway([
      {
        query: "cold hardy trees",
        searchVolume: 4400,
        cpc: 0.8,
        competition: 0.2,
        difficulty: 31,
        intent: "informational",
        monthlySearches: [],
        capturedAt: NOW.toISOString(),
      },
    ]);
    const result = await createAnalyzePage(deps({ keywords })).execute(
      input({ include: ["keywords"] }),
    );

    if (!isOk(result)) throw new Error("expected ok");
    // One task fee covers up to 1,000 keywords, so the batch carries the whole
    // recommended term set — but only the target query comes back.
    expect(keywords.requests[0].queries.length).toBeGreaterThan(1);
    expect(keywords.requests[0].queries).toContain("cold hardy trees");
    expect(result.value.keywords).toHaveLength(1);
    expect(result.value.keywords?.[0].searchVolume).toBe(4400);
  });

  it("reads stored metrics instead of re-buying them", async () => {
    const corpus = new FakeSeoCorpusRepository(
      {
        keywordMetrics: [
          {
            query: "cold hardy trees",
            location: "2840",
            searchVolume: 100,
            cpc: null,
            competition: null,
            difficulty: null,
            intent: null,
            monthlySearches: [],
            capturedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
      () => NOW,
    );
    const keywords = new FakeKeywordMetricsGateway();
    const result = await createAnalyzePage(deps({ corpus, keywords })).execute(
      input({ include: ["keywords"] }),
    );

    if (!isOk(result)) throw new Error("expected ok");
    expect(keywords.requests).toEqual([]);
    expect(result.value.keywords?.[0].searchVolume).toBe(100);
  });
});

describe("AnalyzePage — degraded inputs", () => {
  it("fails when the caller's own page cannot be fetched", async () => {
    const result = await createAnalyzePage(
      deps({ crawler: new FakePageCrawlGateway({}, { [OUR_URL]: "timeout" }) }),
    ).execute(input());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBe("PAGE_UNREACHABLE");
  });

  it("distinguishes an unconfigured provider from an upstream failure", async () => {
    const missing = await createAnalyzePage(
      deps({ serp: new FakeSerpGateway("NOT_CONFIGURED") }),
    ).execute(input());
    expect(isErr(missing) && missing.error).toBe("SERP_NOT_CONFIGURED");

    const upstream = await createAnalyzePage(
      deps({ serp: new FakeSerpGateway("UPSTREAM_ERROR") }),
    ).execute(input());
    expect(isErr(upstream) && upstream.error).toBe("SERP_UNAVAILABLE");
  });

  it("survives competitors that block the crawler, and reports the shrunken sample", async () => {
    const result = await createAnalyzePage(
      deps({
        crawler: new FakePageCrawlGateway(
          { [OUR_URL]: OUR_HTML, "https://a.com/x": RIVAL_HTML },
          { "https://b.com/x": "blocked" },
        ),
      }),
    ).execute(input());

    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.sample.competitors).toBe(2);
    expect(result.value.sample.crawled).toBe(1);
    expect(result.value.sample.crawlFailures).toBe(1);
  });

  it("still produces title and meta swaps when no competitor could be crawled", async () => {
    const result = await createAnalyzePage(
      deps({
        crawler: new FakePageCrawlGateway(
          { [OUR_URL]: OUR_HTML },
          { "https://a.com/x": "blocked", "https://b.com/x": "blocked" },
        ),
      }),
    ).execute(input());

    if (!isOk(result)) throw new Error("expected ok");
    // Title/meta facts come from the SERP itself, so they survive a total
    // crawl failure; body-derived areas correctly disappear.
    const areas = result.value.swaps.map((s) => s.area);
    expect(areas).toContain("title");
    expect(areas).not.toContain("headings");
    expect(areas).not.toContain("length");
  });
});

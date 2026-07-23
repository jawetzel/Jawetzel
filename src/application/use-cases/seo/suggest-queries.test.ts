import { describe, it, expect } from "vitest";
import { isOk, isErr } from "@/domain/shared/result";
import { FakePageCrawlGateway } from "@/application/ports/page-crawl-gateway.fake";
import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import { FakeKeywordMetricsGateway } from "@/application/ports/keyword-metrics-gateway.fake";
import { type KeywordMetric } from "@/application/ports/keyword-metrics-gateway";
import {
  createSuggestQueries,
  type SuggestQueriesInput,
} from "./suggest-queries";

const OUR_URL = "https://weekendplant.com/trees";
const OUR_HTML = `<html><head><title>Trees of the North</title>
  <meta name="description" content="Trees for cold climates."></head>
  <body><main><h1>Trees of the North</h1><h2>Choosing a Site</h2>
  <p>Hardy trees for northern gardens.</p></main></body></html>`;

function llmReturning(queries: string[]): FakeLlmGateway {
  const fake = new FakeLlmGateway();
  fake.chatResponses = [
    {
      hasChoice: true,
      content: JSON.stringify({ queries }),
      toolCalls: [],
      finishReason: "stop",
    },
  ];
  return fake;
}

const metric = (
  query: string,
  searchVolume: number | null,
  difficulty: number | null,
): KeywordMetric => ({
  query,
  searchVolume,
  cpc: null,
  competition: null,
  difficulty,
  intent: "informational",
  monthlySearches: [],
  capturedAt: "2026-07-23T00:00:00.000Z",
});

function input(overrides: Partial<SuggestQueriesInput> = {}): SuggestQueriesInput {
  return {
    url: OUR_URL,
    locationCode: 2840,
    languageCode: "en",
    city: null,
    maxCandidates: 10,
    ...overrides,
  };
}

function deps(
  overrides: Partial<Parameters<typeof createSuggestQueries>[0]> = {},
) {
  return {
    crawler: new FakePageCrawlGateway({ [OUR_URL]: OUR_HTML }),
    llm: llmReturning(["cold hardy trees", "best trees zone 3", "trees of the north"]),
    keywords: new FakeKeywordMetricsGateway([
      metric("cold hardy trees", 4400, 28),
      metric("best trees zone 3", 300, 22),
    ]),
    ...overrides,
  };
}

describe("SuggestQueries", () => {
  it("returns candidates ranked, grounded with real demand where available", async () => {
    const result = await createSuggestQueries(deps()).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    expect(result.value.suggestions.length).toBe(3);
    // The high-volume, winnable query leads.
    expect(result.value.suggestions[0].query).toBe("cold hardy trees");
    expect(result.value.suggestions[0].grounded).toBe(true);
    expect(result.value.suggestions[0].searchVolume).toBe(4400);
    // The one with no metric data is ungrounded, not zero-faked.
    const orphan = result.value.suggestions.find(
      (s) => s.query === "trees of the north",
    );
    expect(orphan?.grounded).toBe(false);
    expect(orphan?.searchVolume).toBeNull();
    expect(result.value.sample).toMatchObject({
      llmCandidates: 3,
      grounded: 2,
      metricsAvailable: true,
    });
  });

  it("sends the page's topical signal and asks for JSON", async () => {
    const llm = llmReturning(["cold hardy trees"]);
    await createSuggestQueries(deps({ llm })).execute(input());

    expect(llm.chatRequests[0].responseFormatJson).toBe(true);
    const userMsg = llm.chatRequests[0].messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("Trees of the North");
  });

  it("fails cleanly when the page cannot be fetched", async () => {
    const result = await createSuggestQueries(
      deps({ crawler: new FakePageCrawlGateway({}, { [OUR_URL]: "timeout" }) }),
    ).execute(input());
    expect(isErr(result) && result.error).toBe("PAGE_UNREACHABLE");
  });

  it("returns NO_SUGGESTIONS when the model emits nothing usable", async () => {
    const llm = new FakeLlmGateway();
    llm.chatResponses = [
      { hasChoice: true, content: "not json", toolCalls: [], finishReason: "stop" },
    ];
    const result = await createSuggestQueries(deps({ llm })).execute(input());
    expect(isErr(result) && result.error).toBe("NO_SUGGESTIONS");
  });

  it("degrades to an unpriced list when the keyword provider throws", async () => {
    const keywords = new FakeKeywordMetricsGateway();
    keywords.fetchMetrics = async () => {
      throw new Error("DataForSEO down");
    };
    const result = await createSuggestQueries(deps({ keywords })).execute(input());
    if (!isOk(result)) throw new Error("expected ok");

    // Still useful: candidates come back, just ungrounded.
    expect(result.value.suggestions.length).toBe(3);
    expect(result.value.sample.metricsAvailable).toBe(false);
    expect(result.value.suggestions.every((s) => !s.grounded)).toBe(true);
  });
});

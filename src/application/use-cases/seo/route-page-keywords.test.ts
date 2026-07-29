import { describe, expect, it } from "vitest";
import { isOk } from "@/domain/shared/result";
import { type GapKeyword } from "@/domain/seo/gap-pile";
import { type SeoTag } from "@/domain/seo/workspace";
import { InMemorySeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository.fake";
import { InMemorySeoGapRepository } from "@/application/ports/seo-gap-repository.fake";
import { InMemorySeoRoutingRepository } from "@/application/ports/seo-routing-repository.fake";
import { FakePageCrawlGateway } from "@/application/ports/page-crawl-gateway.fake";
import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import { createRoutePageKeywords } from "@/application/use-cases/seo/route-page-keywords";
import { createOverrideRouting } from "@/application/use-cases/seo/override-routing";
import { createListBacklog } from "@/application/use-cases/seo/list-backlog";

const PAGE_URL = "https://weekendplant.com/guide";
const HTML = `<html><head><title>Winter Garden Prep</title></head>
<body><h1>Winter Garden Prep</h1><p>Getting a northern garden through the cold.</p></body></html>`;

const TAG: SeoTag = {
  tag: "weekendplant",
  label: "Weekend Plant",
  domain: "weekendplant.com",
  locationCode: 2840,
  languageCode: "en",
  entitySchema: [],
  urgencyTerms: [],
  city: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

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

function chatResult(content: string | null) {
  return { hasChoice: true, content, toolCalls: [], finishReason: "stop" };
}

function build(options: {
  rows?: GapKeyword[];
  llmContent?: string | null;
  crawlFails?: boolean;
  /** Extra URLs the crawler should serve, e.g. a messy variant of the page. */
  alsoServe?: string[];
}) {
  const workspace = new InMemorySeoWorkspaceRepository({ tags: [TAG] });
  const gaps = new InMemorySeoGapRepository(options.rows ?? [row()]);
  const routings = new InMemorySeoRoutingRepository();
  const crawler = options.crawlFails
    ? new FakePageCrawlGateway({}, { [PAGE_URL]: "timeout" })
    : new FakePageCrawlGateway({
        [PAGE_URL]: HTML,
        ...Object.fromEntries((options.alsoServe ?? []).map((u) => [u, HTML])),
      });
  const llm = new FakeLlmGateway();
  llm.chatResponses = [
    chatResult(options.llmContent === undefined ? "{}" : options.llmContent),
  ];

  return {
    gaps,
    routings,
    llm,
    routePageKeywords: createRoutePageKeywords({
      workspace,
      gaps,
      routings,
      crawler,
      llm,
      now: () => new Date("2026-07-28T13:00:00.000Z"),
    }),
    overrideRouting: createOverrideRouting({ routings }),
    listBacklog: createListBacklog({ gaps, routings }),
  };
}

describe("RoutePageKeywords", () => {
  it("routes enrich and create from the model's verdicts", async () => {
    const { routePageKeywords } = build({
      rows: [row({ keyword: "cold hardy trees" }), row({ keyword: "sous vide steak" })],
      llmContent: JSON.stringify({
        routes: [
          { keyword: "cold hardy trees", verdict: "enrich", why: "same subject" },
          { keyword: "sous vide steak", verdict: "create", why: "unrelated" },
        ],
      }),
    });

    const result = await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.counts).toEqual({ improve: 0, enrich: 1, create: 1 });
  });

  it("never asks the model about improve rows", async () => {
    // The vendor already told us which of our URLs holds the ranking. Asking a
    // model to re-derive a measured fact would be strictly worse.
    const { routePageKeywords, llm } = build({
      rows: [
        row({ keyword: "nearly there", bucket: "improve", ourUrl: PAGE_URL }),
      ],
    });

    const result = await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.counts.improve).toBe(1);
    expect(llm.chatRequests).toHaveLength(0);
  });

  it("excludes improve rows owned by another page and says so", async () => {
    const { routePageKeywords } = build({
      rows: [
        row({
          keyword: "elsewhere",
          bucket: "improve",
          ourUrl: "https://weekendplant.com/other",
        }),
      ],
    });

    const result = await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ownedElsewhere).toBe(1);
    expect(result.value.routings).toHaveLength(0);
  });

  it("keys routings by normalized page URL", async () => {
    // Four spellings of one page must not become four routing histories —
    // that would silently break the backlog. The key comes from where the
    // crawl actually landed, then through `pageKey`.
    const messy = `${PAGE_URL}/?utm_source=x#top`;
    const { routePageKeywords, routings } = build({
      alsoServe: [messy],
      llmContent: JSON.stringify({
        routes: [{ keyword: "cold hardy trees", verdict: "enrich" }],
      }),
    });

    await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: messy,
    });

    const stored = await routings.list({ tag: "weekendplant", limit: 10 });
    expect(stored[0].pageUrl).toBe(PAGE_URL);
  });

  it("defaults to create when the model returns nothing usable", async () => {
    const { routePageKeywords } = build({ llmContent: "not json at all" });

    const result = await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.counts).toEqual({ improve: 0, enrich: 0, create: 1 });
  });

  it("refuses to route without accepted keywords", async () => {
    const { routePageKeywords } = build({ rows: [row({ status: "new" })] });

    const result = await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(result).toEqual({ ok: false, error: "NOTHING_ACCEPTED" });
  });

  it("reports an unreachable page rather than routing blind", async () => {
    const { routePageKeywords } = build({ crawlFails: true });

    const result = await routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(result).toEqual({ ok: false, error: "PAGE_UNREACHABLE" });
  });

  it("preserves a human override across a re-route", async () => {
    // The model may change its mind; a person's correction outranks it.
    const ctx = build({
      llmContent: JSON.stringify({
        routes: [{ keyword: "cold hardy trees", verdict: "create" }],
      }),
    });

    await ctx.routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });
    await ctx.overrideRouting.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
      keyword: "cold hardy trees",
      verdict: "enrich",
    });

    ctx.llm.chatResponses = [
      chatResult(
        JSON.stringify({
          routes: [{ keyword: "cold hardy trees", verdict: "create" }],
        }),
      ),
    ];
    const second = await ctx.routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.preserved).toBe(1);
    expect(second.value.counts.enrich).toBe(1);
  });
});

describe("ListBacklog", () => {
  it("returns unclaimed keywords with the coverage that qualifies them", async () => {
    const ctx = build({
      rows: [row({ keyword: "cold hardy trees" }), row({ keyword: "sous vide steak" })],
      llmContent: JSON.stringify({
        routes: [
          { keyword: "cold hardy trees", verdict: "enrich" },
          { keyword: "sous vide steak", verdict: "create" },
        ],
      }),
    });
    await ctx.routePageKeywords.execute({
      tag: "weekendplant",
      pageUrl: PAGE_URL,
    });

    const backlog = await ctx.listBacklog.execute({ tag: "weekendplant" });

    expect(backlog.rows.map((r) => r.keyword)).toEqual(["sous vide steak"]);
    expect(backlog.coverage).toEqual({
      pagesRouted: 1,
      keywordsClaimed: 1,
      keywordsAccepted: 2,
    });
  });

  it("reports zero coverage before anything has been routed", async () => {
    // An early backlog is mostly "we haven't looked yet" — the figure is what
    // stops it reading as a finding.
    const { listBacklog } = build({});

    const backlog = await listBacklog.execute({ tag: "weekendplant" });

    expect(backlog.coverage.pagesRouted).toBe(0);
    expect(backlog.rows).toHaveLength(1);
  });
});

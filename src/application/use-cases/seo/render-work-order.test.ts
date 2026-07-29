import { describe, expect, it } from "vitest";
import { isOk } from "@/domain/shared/result";
import { RENDERER_VERSION } from "@/domain/seo/work-order";
import { type Swap } from "@/domain/seo/swaps";
import { type StoredPageAnalysis } from "@/application/ports/seo-analysis-repository";
import { FakeSeoAnalysisRepository } from "@/application/ports/seo-analysis-repository.fake";
import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import { createRenderWorkOrder } from "@/application/use-cases/seo/render-work-order";

function swap(area: Swap["area"], current: number, suggested: number): Swap {
  return {
    area,
    current: null,
    currentScore: current,
    suggestedScore: suggested,
    signals:
      area === "title"
        ? {
            terms: [{ term: "cold hardy", in: 8, of: 10 }],
            lengthMedian: 54,
            examples: ["23 Cold Hardy Trees for Zone 3"],
          }
        : undefined,
  };
}

function analysis(swaps: Swap[]): StoredPageAnalysis {
  return {
    id: "analysis-1",
    propertyId: "weekendplant.com",
    url: "https://weekendplant.com/guide",
    query: "cold hardy trees",
    location: "2840",
    runAt: "2026-07-28T12:00:00.000Z",
    formulaVersion: "1.0.0",
    swaps,
    sample: {
      competitors: 9,
      crawled: 7,
      crawlFailures: 2,
      serpCapturedAt: "2026-07-28T12:00:00.000Z",
      serpFromCorpus: false,
      ourPosition: 8,
      features: [],
    },
  };
}

function chatResult(content: string | null) {
  return { hasChoice: true, content, toolCalls: [], finishReason: "stop" };
}

function build(options: {
  swaps?: Swap[];
  llmContent?: string | null;
  responses?: Array<ReturnType<typeof chatResult>>;
}) {
  const analyses = new FakeSeoAnalysisRepository([
    analysis(options.swaps ?? [swap("title", 12, 84), swap("headings", 30, 90)]),
  ]);
  const llm = new FakeLlmGateway();
  llm.chatResponses =
    options.responses ?? [chatResult(options.llmContent ?? "{}")];
  return {
    analyses,
    llm,
    renderWorkOrder: createRenderWorkOrder({
      analyses,
      llm,
      now: () => new Date("2026-07-28T13:00:00.000Z"),
    }),
  };
}

const GOOD_RESPONSE = JSON.stringify({
  headline: "Rewrite the title around 'cold hardy'.",
  items: [
    {
      area: "title",
      action: "Lead the title with the phrase 'cold hardy trees'.",
      evidence: "8 of 10 ranking pages use it.",
    },
    {
      area: "headings",
      action: "Add sections for hardiness zones and best varieties.",
      evidence: "Both recur across the ranking pages.",
    },
  ],
  titleOptions: ["23 Cold Hardy Trees for Zone 3 Gardens"],
  metaOption: "Which trees survive northern winters?",
});

describe("RenderWorkOrder", () => {
  it("renders items and title candidates from the stored swaps", async () => {
    const { renderWorkOrder } = build({ llmContent: GOOD_RESPONSE });

    const result = await renderWorkOrder.execute({ analysisId: "analysis-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // title 12→84 is 72 points of leverage, headings 30→90 is 60.
    expect(result.value.workOrder.items.map((i) => i.area)).toEqual([
      "title",
      "headings",
    ]);
    // The prose the engine deliberately refuses to write.
    expect(result.value.workOrder.titleOptions).toEqual([
      "23 Cold Hardy Trees for Zone 3 Gardens",
    ]);
    expect(result.value.cached).toBe(false);
  });

  it("takes leverage from the swap, never from the model", async () => {
    // Otherwise prose could reorder a measured ranking.
    const { renderWorkOrder } = build({
      llmContent: JSON.stringify({
        headline: "x",
        items: [
          // The model claims headings matter most and title barely at all.
          { area: "headings", action: "c", evidence: "d", leverage: 999 },
          { area: "title", action: "a", evidence: "b", leverage: 1 },
        ],
      }),
    });

    const result = await renderWorkOrder.execute({ analysisId: "analysis-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // The measurements say otherwise: title 12→84 is 72, headings 30→90 is 60.
    expect(result.value.workOrder.items[0]).toMatchObject({
      area: "title",
      leverage: 72,
    });
    expect(result.value.workOrder.items[1].leverage).toBe(60);
  });

  it("drops an item for an area the brief never contained", async () => {
    // The one hallucination that survives moving the model to the edge: work
    // the measurements never supported.
    const { renderWorkOrder } = build({
      swaps: [swap("title", 12, 84)],
      llmContent: JSON.stringify({
        headline: "x",
        items: [
          { area: "title", action: "a", evidence: "b" },
          { area: "schema", action: "invented", evidence: "nothing measured it" },
        ],
      }),
    });

    const result = await renderWorkOrder.execute({ analysisId: "analysis-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.workOrder.items.map((i) => i.area)).toEqual(["title"]);
  });

  it("ignores swaps with no meaningful leverage", async () => {
    const { renderWorkOrder } = build({
      swaps: [swap("title", 80, 82)],
      llmContent: GOOD_RESPONSE,
    });

    const result = await renderWorkOrder.execute({ analysisId: "analysis-1" });

    expect(result).toEqual({ ok: false, error: "NOTHING_TO_DO" });
  });

  it("returns the cached rendering without calling the model again", async () => {
    const ctx = build({
      responses: [chatResult(GOOD_RESPONSE), chatResult(GOOD_RESPONSE)],
    });

    await ctx.renderWorkOrder.execute({ analysisId: "analysis-1" });
    const second = await ctx.renderWorkOrder.execute({
      analysisId: "analysis-1",
    });

    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.cached).toBe(true);
    expect(ctx.llm.chatRequests).toHaveLength(1);
  });

  it("re-renders on request, ignoring the cache", async () => {
    const ctx = build({
      responses: [chatResult(GOOD_RESPONSE), chatResult(GOOD_RESPONSE)],
    });

    await ctx.renderWorkOrder.execute({ analysisId: "analysis-1" });
    const second = await ctx.renderWorkOrder.execute({
      analysisId: "analysis-1",
      refresh: true,
    });

    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.cached).toBe(false);
    expect(ctx.llm.chatRequests).toHaveLength(2);
  });

  it("ignores a cached rendering from an older renderer", async () => {
    // The version stamp exists so a stale rendering is recognizable rather
    // than silently authoritative.
    const ctx = build({
      responses: [chatResult(GOOD_RESPONSE)],
    });
    await ctx.analyses.saveWorkOrder({
      analysisId: "analysis-1",
      workOrder: {
        headline: "stale",
        items: [],
        titleOptions: [],
        metaOption: null,
        rendererVersion: "0.0.1",
        model: "old",
        renderedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await ctx.renderWorkOrder.execute({
      analysisId: "analysis-1",
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.cached).toBe(false);
    expect(result.value.workOrder.rendererVersion).toBe(RENDERER_VERSION);
  });

  it("fails cleanly when the model returns nothing parseable", async () => {
    const { renderWorkOrder } = build({ llmContent: "sorry, I can't help" });

    const result = await renderWorkOrder.execute({ analysisId: "analysis-1" });

    expect(result).toEqual({ ok: false, error: "RENDER_FAILED" });
  });

  it("reports a missing analysis rather than rendering an empty one", async () => {
    const { renderWorkOrder } = build({ llmContent: GOOD_RESPONSE });

    const result = await renderWorkOrder.execute({ analysisId: "nope" });

    expect(result).toEqual({ ok: false, error: "ANALYSIS_NOT_FOUND" });
  });
});

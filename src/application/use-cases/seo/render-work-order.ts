import { ok, err, type Result } from "@/domain/shared/result";
import {
  buildWorkOrderBrief,
  parseWorkOrder,
  RENDERER_VERSION,
  type WorkOrder,
  type WorkOrderBrief,
} from "@/domain/seo/work-order";
import { type Swap } from "@/domain/seo/swaps";
import { type LlmGateway } from "@/application/ports/llm-gateway";
import { type SeoAnalysisRepository } from "@/application/ports/seo-analysis-repository";

/**
 * RenderWorkOrder — layer 4b, the last mile.
 *
 * Turns a stored analysis's swaps into the sentence seo.md set as the target:
 * *"I need to reword this, this post needs adjusting in these ways, and we need
 * X, Y, Z for meta tags and JSON-LD."*
 *
 * **Costs nothing at the vendor.** It reads a run that was already paid for and
 * writes prose from its swaps — no SERP, no crawl, no keyword call. Re-rendering
 * is tokens only, which is what makes the cached result safe to throw away and
 * regenerate whenever the renderer improves.
 *
 * **Deliberately not `include=workOrder` on `analyze`.** Folding it in would
 * make a deterministic endpoint non-deterministic and add a model round trip to
 * a call that already runs 10–40s. Keeping it a separate read preserves the
 * engine's contract at the route level, not merely in the documentation.
 *
 * The model writes; it never measures. Every leverage number in the output is
 * lifted from the swap that produced it, and an item for an area the brief never
 * contained is dropped in `parseWorkOrder` — the model cannot invent work the
 * measurements never supported.
 */

const LLM_MODEL = "gpt-5.4-mini";
/** Prose, so a little sampling; low enough that two runs stay recognisable. */
const TEMPERATURE = 0.3;
const MAX_TOKENS = 1600;

const SYSTEM_PROMPT = [
  "You turn measured SEO findings into a short work order for the person who owns the page.",
  'Return ONLY JSON: { "headline": "...", "items": [ { "area": "...", "action": "...", "evidence": "..." } ],',
  '"titleOptions": ["..."], "metaOption": "..." }.',
  "Rules:",
  "- Use ONLY the findings given. Never invent a competitor, a number, or a fact that is not in them.",
  "- One item per area you were given, using that exact area name. Do not add areas.",
  '- "action" is imperative and concrete: what to change, in one sentence.',
  '- "evidence" cites the measurement in plain words, e.g. "8 of 10 ranking pages use it".',
  '- "headline" is one sentence naming the single highest-value change.',
  "- titleOptions: 2-4 complete, ready-to-use page titles built from the title signals,",
  "  near the observed median length. If no title finding was given, return [].",
  "- metaOption: one ready-to-use meta description, or null if no meta finding was given.",
  "- Write plainly. No SEO jargon the owner would have to look up. No preamble.",
].join(" ");

export interface RenderWorkOrderInput {
  analysisId: string;
  /** Ignore a cached rendering and write a fresh one. */
  refresh?: boolean;
}

export interface RenderWorkOrderOutput {
  analysisId: string;
  url: string;
  query: string;
  workOrder: WorkOrder;
  /** True when the stored rendering was returned without calling the model. */
  cached: boolean;
}

export type RenderWorkOrderError =
  | "ANALYSIS_NOT_FOUND"
  | "NOTHING_TO_DO"
  | "RENDER_FAILED";

export interface RenderWorkOrder {
  execute(
    input: RenderWorkOrderInput,
  ): Promise<Result<RenderWorkOrderOutput, RenderWorkOrderError>>;
}

export function createRenderWorkOrder(deps: {
  analyses: SeoAnalysisRepository;
  llm: LlmGateway;
  now?: () => Date;
}): RenderWorkOrder {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const analysis = await deps.analyses.findById(input.analysisId);
      if (!analysis) return err("ANALYSIS_NOT_FOUND");

      if (!input.refresh) {
        const cached = await deps.analyses.findWorkOrder(input.analysisId);
        // A rendering from an older renderer is stale by definition — the
        // version stamp exists so that is recognizable rather than silently
        // authoritative.
        if (cached && cached.rendererVersion === RENDERER_VERSION) {
          return ok({
            analysisId: input.analysisId,
            url: analysis.url,
            query: analysis.query,
            workOrder: cached,
            cached: true,
          });
        }
      }

      const brief = buildWorkOrderBrief({
        url: analysis.url,
        query: analysis.query,
        swaps: analysis.swaps,
        ourPosition: analysis.sample.ourPosition,
        competitorsCrawled: analysis.sample.crawled,
        serpFeatures: analysis.sample.features,
      });

      // A page already matching everything measured has no work order, and
      // saying so is a better answer than prose padded out to look useful.
      if (brief.swaps.length === 0) return err("NOTHING_TO_DO");

      let content: string | null = null;
      try {
        const completion = await deps.llm.createChatCompletion({
          model: LLM_MODEL,
          temperature: TEMPERATURE,
          maxCompletionTokens: MAX_TOKENS,
          responseFormatJson: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(brief) },
          ],
        });
        content = completion.content;
      } catch (cause) {
        // Log once, here. The caller still has the swaps; only the prose failed.
        console.error("[seo] work-order rendering failed:", cause);
        return err("RENDER_FAILED");
      }

      const workOrder = parseWorkOrder({
        content,
        brief,
        model: LLM_MODEL,
        renderedAt: now().toISOString(),
      });
      if (!workOrder) return err("RENDER_FAILED");

      // Best-effort, like every other derived write in this slice: a cache miss
      // next time costs tokens, a failed request costs the caller their answer.
      try {
        await deps.analyses.saveWorkOrder({
          analysisId: input.analysisId,
          workOrder,
        });
      } catch (cause) {
        console.error("[seo] work-order cache write failed:", cause);
      }

      return ok({
        analysisId: input.analysisId,
        url: analysis.url,
        query: analysis.query,
        workOrder,
        cached: false,
      });
    },
  };
}

/**
 * The brief, flattened for the model.
 *
 * Note what is *not* here: no SERP, no page HTML, no scores to recompute. Only
 * the swaps the engine emitted, which is what keeps every claim in the output
 * checkable against a stored measurement.
 */
function buildPrompt(brief: WorkOrderBrief): string {
  const lines = [
    `PAGE: ${brief.url}`,
    `TARGET QUERY: ${brief.query}`,
    brief.ourPosition === null
      ? "CURRENT POSITION: not in the top 10"
      : `CURRENT POSITION: #${brief.ourPosition}`,
    `COMPETITOR PAGES MEASURED: ${brief.competitorsCrawled}`,
    brief.serpFeatures.length > 0
      ? `SERP FEATURES: ${brief.serpFeatures.join(", ")}`
      : "SERP FEATURES: none",
    "",
    "FINDINGS (highest leverage first)",
  ];

  for (const swap of brief.swaps) {
    lines.push("", describeSwap(swap));
  }

  return lines.join("\n");
}

/** One swap as plain lines. Vendor and code shapes never reach the model. */
function describeSwap(swap: Swap): string {
  const parts = [
    `AREA: ${swap.area}`,
    `  match now: ${swap.currentScore}% → achievable: ${swap.suggestedScore}%`,
    `  currently: ${render(swap.current)}`,
  ];

  if (swap.suggested !== undefined) {
    parts.push(`  data says add: ${render(swap.suggested)}`);
  }

  const signals = swap.signals;
  if (signals?.terms?.length) {
    parts.push(
      `  terms competitors use: ${signals.terms
        .map((t) => `"${t.term}" (${t.in} of ${t.of})`)
        .join(", ")}`,
    );
  }
  if (signals?.patterns?.length) {
    parts.push(
      `  patterns: ${signals.patterns
        .map((t) => `${t.term} (${t.in} of ${t.of})`)
        .join(", ")}`,
    );
  }
  if (signals?.lengthMedian !== undefined) {
    parts.push(`  median length across ranking pages: ${signals.lengthMedian}`);
  }
  if (signals?.examples?.length) {
    // The highest-value field for a model consumer: verbatim text from the
    // pages currently ranking beats any instruction we could phrase.
    parts.push(
      ...["  verbatim from ranking pages:"],
      ...signals.examples.slice(0, 5).map((ex) => `    - ${ex}`),
    );
  }

  return parts.join("\n");
}

function render(value: string | string[] | number | null | undefined): string {
  if (value === null || value === undefined) return "(none)";
  if (Array.isArray(value)) {
    return value.length === 0 ? "(none)" : value.join(", ");
  }
  return String(value);
}

import { type Swap, type SwapArea } from "@/domain/seo/swaps";

/**
 * Layer 4b: the work order — the last mile from measured swaps to something a
 * human acts on without knowing SEO.
 *
 * seo.md Part 4b named the target output in the caller's own words: *"oh I see —
 * I need to reword this, this blog post needs adjusting in these ways, and we
 * need to do X, Y, Z for meta tags and JSON-LD."* The engine deliberately stops
 * one step short of that, emitting `signals` rather than prose, on the reasoning
 * that "any consumer with a model will write something better from the raw
 * signals than our template could." **This is that consumer.**
 *
 * The split holds precisely: the engine stays a pure function of stored inputs,
 * and the rendering sits outside it. Nothing here recomputes a score, and the
 * renderer never sees the SERP — only the swaps the engine already produced.
 *
 * This module owns the two deterministic halves: condensing swaps into a brief
 * (below) and validating what comes back (`parseWorkOrder`). The prose in
 * between is the model's.
 */

/** Bumped when the brief or the output contract changes meaning. */
export const RENDERER_VERSION = "1.0.0";

export interface WorkOrderItem {
  area: SwapArea;
  /** Imperative, one sentence: what to actually do. */
  action: string;
  /** The measured reason, grounded in the swap's own operands. */
  evidence: string;
  /** `suggestedScore - currentScore` — carried through so the sort is visible. */
  leverage: number;
}

export interface WorkOrder {
  /** One sentence: the single most valuable change to this page. */
  headline: string;
  items: WorkOrderItem[];
  /** Actual title candidates — the prose the engine refuses to write. */
  titleOptions: string[];
  /** A meta description candidate, or null when meta wasn't a swap. */
  metaOption: string | null;
  rendererVersion: string;
  model: string;
  renderedAt: string;
}

/**
 * Swaps worth writing about. A swap that would change nothing is noise in a
 * work order however interesting it is as data.
 *
 * The floor is deliberately low: at 5 points the change is real but marginal,
 * and a reader deciding what to skip is better served by seeing it ranked last
 * than by not seeing it at all.
 */
const MIN_LEVERAGE = 5;

export interface WorkOrderBrief {
  url: string;
  query: string;
  ourPosition: number | null;
  competitorsCrawled: number;
  serpFeatures: string[];
  /** Swaps worth acting on, highest leverage first. */
  swaps: Swap[];
}

/**
 * Condense one analysis into the model's input.
 *
 * Everything here is a filter or a sort over data the engine already produced —
 * no new judgment, and nothing the model could not verify against the swaps it
 * is handed. Keeping it deterministic is what makes the rendering reproducible
 * enough to diff even though the prose is not.
 */
export function buildWorkOrderBrief(input: {
  url: string;
  query: string;
  swaps: Swap[];
  ourPosition: number | null;
  competitorsCrawled: number;
  serpFeatures: string[];
}): WorkOrderBrief {
  const swaps = input.swaps
    .filter((swap) => leverageOf(swap) >= MIN_LEVERAGE)
    .sort((a, b) => leverageOf(b) - leverageOf(a));

  return {
    url: input.url,
    query: input.query,
    ourPosition: input.ourPosition,
    competitorsCrawled: input.competitorsCrawled,
    serpFeatures: input.serpFeatures,
    swaps,
  };
}

export function leverageOf(swap: Swap): number {
  return swap.suggestedScore - swap.currentScore;
}

/** Areas the model may return. Anything else is a hallucinated section. */
const AREAS: SwapArea[] = [
  "title",
  "meta",
  "headings",
  "facts",
  "entities",
  "questions",
  "schema",
  "links",
  "length",
];

/**
 * Validate a rendered work order against the brief it was written from.
 *
 * Two rules, and they are the whole reason this is a pure function rather than
 * a `JSON.parse` at the call site:
 *
 * 1. **An item for an area that was not in the brief is dropped.** The model
 *    would otherwise be free to invent work the measurements never supported —
 *    which is exactly the failure mode the no-LLM contract was protecting
 *    against, and the only one that survives moving the model to the edge.
 * 2. **`leverage` comes from the swap, never from the model.** It is arithmetic
 *    the engine already did; re-asking for it would let prose reorder a
 *    measured ranking.
 */
export function parseWorkOrder(input: {
  content: string | null;
  brief: WorkOrderBrief;
  model: string;
  renderedAt: string;
}): WorkOrder | null {
  if (!input.content) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const leverageByArea = new Map(
    input.brief.swaps.map((swap) => [swap.area, leverageOf(swap)]),
  );

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const seen = new Set<SwapArea>();
  const items: WorkOrderItem[] = [];

  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const area = AREAS.find((a) => a === raw.area);
    // Unknown area, an area the brief never mentioned, or a repeat — all three
    // are the model going beyond what was measured.
    if (!area || !leverageByArea.has(area) || seen.has(area)) continue;
    const action = text(raw.action);
    if (!action) continue;
    seen.add(area);
    items.push({
      area,
      action,
      evidence: text(raw.evidence) ?? "",
      leverage: leverageByArea.get(area) ?? 0,
    });
  }

  if (items.length === 0) return null;

  return {
    headline: text(parsed.headline) ?? items[0].action,
    // Present in brief order — the engine's ranking, not the model's.
    items: items.sort((a, b) => b.leverage - a.leverage),
    titleOptions: stringList(parsed.titleOptions).slice(0, 5),
    metaOption: text(parsed.metaOption),
    rendererVersion: RENDERER_VERSION,
    model: input.model,
    renderedAt: input.renderedAt,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

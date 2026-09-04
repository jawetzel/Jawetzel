import { type GeometryReport } from "@/domain/embroidery/geometry";
import { type SelectedThread } from "@/domain/embroidery/thread";

/**
 * Contract for the two LLM-backed collaborators of
 * {@link RunEmbroideryPipeline}: the thread-palette selection step and the SVG
 * tag/clean step. The use-case injects both as functions (`SelectPaletteFn` /
 * `TagSvgFn`), so this file holds the **DTOs those functions trade in** — the
 * use-case's public contract, owned by the application layer.
 *
 * These shapes previously lived in `app/embroidery/_lib/ai/select-palette.ts`
 * and `.../ai/tag-svg.ts`, which made the application layer import outward into
 * `app/` (a `application-no-outward` violation — the dependency rule reversed
 * for nothing but a type name). The implementations stay in `_lib` for now, in
 * line with the migration's "one vertical slice at a time"; they now import
 * these types *inward* and re-export them, so every existing consumer import is
 * unchanged.
 */

/**
 * The AI's per-path stitch decision. `*_params` are deliberately widened to
 * `Record<...>` rather than the enumerated Ink/Stitch key unions: the narrow
 * vocabulary is a property of the *prompt* (and of the response filter in
 * `tag-svg.ts`), not of this boundary, and it belongs next to the prompt that
 * enumerates it.
 */
export type AiPathDecision = {
  index: number;
  stitch_type: "fill" | "satin" | "running" | "skip";
  fill_params?: Record<string, number>;
  satin_params?: Record<string, number>;
  running_params?: Record<string, number | string>;
  notes?: string;
};

/** The raw AI tag response, persisted verbatim as the `ai-tags.json` artifact. */
export type AiPathTags = { paths: AiPathDecision[] };

/**
 * Cluster → thread map produced by the palette step, plus the routing stats the
 * pipeline logs. Parallel arrays: `clusters[i]` is a source-image pixel-cluster
 * hex, `routes[i]` the index into the selected palette the AI chose for it, or
 * `-1` when the AI didn't route it (the worker then falls back to Lab-ΔE
 * nearest, which is what `fallback` counts).
 *
 * This is the *richer* sibling of the compute gateway's `ClusterRouting`
 * (`{ clusters, routes }`) — the extra counters are for logging only, which is
 * why the wire-facing port keeps the narrow pair.
 */
export type PaletteRouting = {
  clusters: string[];
  routes: number[];
  aiRouted: number;
  fallback: number;
};

/** Output of the AI thread-palette selection step. */
export type PaletteSelection = {
  threads: SelectedThread[];
  extractOutline: boolean;
  routing: PaletteRouting | null;
  rationale?: string;
};

/** Output of the AI SVG tag/clean step. */
export type TagSvgResult = {
  cleanedSvgBytes: Uint8Array;
  taggedSvgBytes: Uint8Array;
  geometryReport: GeometryReport;
  aiTags: AiPathTags | null;
};

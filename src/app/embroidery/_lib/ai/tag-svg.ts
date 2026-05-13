import {
  analyzeSvg,
  findRedundantSameColorPaths,
  isAmbiguousStitchType,
  stripPaths,
  type GeometryReport,
  type PathRecord,
} from "../geometry";
import {
  applyInkstitchAttrs,
  buildSnapper,
  type ClusterRouting,
} from "../inkstitch/apply-attrs";
import type { Thread } from "../inkstitch/gpl-palette";
import { getOpenAI } from "@/lib/ai/client";
import { TAG_SVG_SYSTEM_PROMPT } from "./prompts";

type StitchType = "fill" | "satin" | "running" | "skip";

const FILL_PARAM_KEYS = [
  "angle",
  "row_spacing_mm",
  "max_stitch_length_mm",
  "running_stitch_length_mm",
  "staggers",
  "expand_mm",
  "pull_compensation_mm",
] as const;

const SATIN_PARAM_KEYS = [
  "zigzag_spacing_mm",
  "running_stitch_length_mm",
  "running_stitch_position",
  "short_stitch_inset",
  "short_stitch_distance_mm",
] as const;

const RUNNING_PARAM_KEYS = [
  "running_stitch_length_mm",
  "bean_stitch_repeats",
  "max_stitch_length_mm",
] as const;

type FillParams = Partial<Record<(typeof FILL_PARAM_KEYS)[number], number>>;
type SatinParams = Partial<Record<(typeof SATIN_PARAM_KEYS)[number], number>>;
type RunningParams = Partial<
  Record<(typeof RUNNING_PARAM_KEYS)[number], number | string>
>;

type PathTag = {
  index: number;
  stitch_type: StitchType;
  fill_params?: FillParams;
  satin_params?: SatinParams;
  running_params?: RunningParams;
  notes?: string;
};

type AiResponse = { paths: PathTag[] };

type MetadataRow = {
  index: number;
  color: string;
  bbox_frac: [number, number, number, number];
  area_mm2: number;
  width_mm: number;
  length_mm: number;
  aspect: number;
  angle_deg: number;
  suggested: Exclude<StitchType, "skip">;
};

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1000) / 1000;
}

function buildMetadataTable(
  report: GeometryReport,
  kept: PathRecord[],
): MetadataRow[] {
  const vw = report.viewBox.w || 1;
  const vh = report.viewBox.h || 1;
  // `aiIndex` is the position in the cleaned SVG (after geometric-skip AND
  // enclosure-redundancy stripping), so it must come from the same `kept`
  // array applyInkstitchAttrs will receive. We assign indices first, THEN
  // drop the confident classifications — keeping the table sparse without
  // shifting indices off the path positions.
  return kept
    .map((p, aiIndex) => ({ p, aiIndex }))
    .filter(({ p }) => isAmbiguousStitchType(p))
    .map(({ p, aiIndex }) => ({
      index: aiIndex,
      color: p.fillColor,
      bbox_frac: [
        round3(p.bboxPx.x / vw),
        round3(p.bboxPx.y / vh),
        round3(p.bboxPx.w / vw),
        round3(p.bboxPx.h / vh),
      ] as [number, number, number, number],
      area_mm2: round2(p.areaMm2),
      width_mm: round2(p.obbWidthMm),
      length_mm: round2(p.obbLengthMm),
      aspect: Number.isFinite(p.aspectRatio) ? round2(p.aspectRatio) : 999,
      angle_deg: Math.round(p.principalAngleDeg),
      suggested: p.suggestion.stitch_type as Exclude<StitchType, "skip">,
    }));
}

async function askOpenAI(
  table: MetadataRow[],
  pngUrl: string,
  size: string,
): Promise<AiResponse> {
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: TAG_SVG_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Hoop size: ${size} (inches, width x height).\n\n` +
              "Per-path metadata table (index matches path position in the cleaned SVG; geometric noise already removed):\n" +
              "```json\n" +
              JSON.stringify(table) +
              "\n```\n\n" +
              "The source PNG is attached. For each index, confirm or override `suggested` using the PNG for semantic context, and pick Ink/Stitch params only where a non-default is justified. Return the JSON object described in the system prompt.",
          },
          {
            type: "image_url",
            image_url: { url: pngUrl, detail: "high" },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as AiResponse).paths)
  ) {
    throw new Error("AI response missing `paths` array");
  }
  return parsed as AiResponse;
}

export type TagSvgResult = {
  cleanedSvgBytes: Uint8Array;
  taggedSvgBytes: Uint8Array;
  geometryReport: GeometryReport;
  aiTags: AiResponse | null;
};

export type TagSvgOptions = {
  threadPalette?: Thread[];
  clusterRouting?: ClusterRouting;
  applyUnderlay?: boolean;
};

export async function tagSvg(
  svgBytes: Uint8Array,
  pngUrl: string,
  size: string,
  options: TagSvgOptions = {},
): Promise<TagSvgResult> {
  const { threadPalette, clusterRouting, applyUnderlay } = options;
  const geometryReport = analyzeSvg(svgBytes);

  // Predict each surviving path's post-snap thread color so we can find
  // paths that will end up the same thread color as a parent path after the
  // snap. The snap collapses multiple trace-time clusters onto one thread,
  // which is the only way the SVG ever gets nested same-color paths to dedupe
  // (potrace itself never emits them within a single mask).
  const snap = buildSnapper({
    ...(threadPalette ? { threadPalette } : {}),
    ...(clusterRouting ? { clusterRouting } : {}),
  });
  const preEnclosureKept = geometryReport.paths.filter(
    (p) => p.suggestion.stitch_type !== "skip",
  );
  const snappedByIndex = new Map<number, string>(
    preEnclosureKept.map((r) => [r.index, snap(r.fillColor).toLowerCase()]),
  );
  const redundant = findRedundantSameColorPaths(
    preEnclosureKept,
    snappedByIndex,
  );

  const drop = new Set<number>(
    geometryReport.paths
      .filter((p) => p.suggestion.stitch_type === "skip")
      .map((p) => p.index),
  );
  for (const idx of redundant) drop.add(idx);
  const cleanedSvgBytes = stripPaths(svgBytes, drop);

  const keptRecords = preEnclosureKept.filter((p) => !redundant.has(p.index));

  const table = buildMetadataTable(geometryReport, keptRecords);
  // Empty table means every kept path is a confident classification — skip
  // the AI call but still run applyInkstitchAttrs so the deterministic
  // suggestions get baked in (inkstitch namespace, per-path attrs, color
  // snap). Previously this returned cleanedSvgBytes unmodified, which left
  // the SVG without any inkstitch metadata at all.
  const aiTags: AiResponse | null =
    table.length === 0 ? null : await askOpenAI(table, pngUrl, size);
  const taggedSvgBytes = applyInkstitchAttrs(
    cleanedSvgBytes,
    aiTags?.paths ?? [],
    keptRecords,
    {
      // The snap pass should honor the AI's cluster→thread routing first,
      // falling back to RGB-nearest only for unrouted colors. Without the
      // routing here, the snap pass would silently re-pick a "closer" thread
      // for any color the trace stage emitted as a cluster centroid (rather
      // than a thread hex) and undo the AI's semantic decisions.
      ...(threadPalette ? { threadPalette } : {}),
      ...(clusterRouting ? { clusterRouting } : {}),
      ...(applyUnderlay === undefined ? {} : { applyUnderlay }),
    },
  );

  return {
    cleanedSvgBytes,
    taggedSvgBytes,
    geometryReport,
    aiTags,
  };
}

import { analyzeSvg, stripPaths, type GeometryReport } from "../geometry";
import { applyInkstitchAttrs } from "../inkstitch/apply-attrs";
import type { Thread } from "../inkstitch/gpl-palette";
import { getOpenAI } from "./client";
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

function buildMetadataTable(report: GeometryReport): MetadataRow[] {
  const vw = report.viewBox.w || 1;
  const vh = report.viewBox.h || 1;
  const kept = report.paths.filter((p) => p.suggestion.stitch_type !== "skip");

  return kept.map((p, aiIndex) => ({
    index: aiIndex,
    color: p.fillColor,
    bbox_frac: [
      round3(p.bboxPx.x / vw),
      round3(p.bboxPx.y / vh),
      round3(p.bboxPx.w / vw),
      round3(p.bboxPx.h / vh),
    ],
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
    model: "gpt-5.4",
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
  applyUnderlay?: boolean;
};

export async function tagSvg(
  svgBytes: Uint8Array,
  pngUrl: string,
  size: string,
  options: TagSvgOptions = {},
): Promise<TagSvgResult> {
  const { threadPalette, applyUnderlay } = options;
  const geometryReport = analyzeSvg(svgBytes);
  const geometricSkips = geometryReport.paths
    .filter((p) => p.suggestion.stitch_type === "skip")
    .map((p) => p.index);
  const cleanedSvgBytes = stripPaths(svgBytes, geometricSkips);

  const table = buildMetadataTable(geometryReport);
  if (table.length === 0) {
    return {
      cleanedSvgBytes,
      taggedSvgBytes: cleanedSvgBytes,
      geometryReport,
      aiTags: null,
    };
  }

  const aiTags = await askOpenAI(table, pngUrl, size);
  const keptRecords = geometryReport.paths.filter(
    (p) => p.suggestion.stitch_type !== "skip",
  );
  const taggedSvgBytes = applyInkstitchAttrs(
    cleanedSvgBytes,
    aiTags.paths,
    keptRecords,
    {
      // When we have a thread palette (AI picked from available threads), we
      // still snap — but to THAT palette. Palette-constrained quantize upstream
      // means the trace hex values already match, so this is idempotent.
      ...(threadPalette ? { threadPalette } : {}),
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

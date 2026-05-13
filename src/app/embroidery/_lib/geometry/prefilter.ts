import type { RawPath } from "./analyze-svg";
import { absoluteArea, axisAlignedBbox, orientedBbox } from "./metrics";
import type { PathRecord, StitchKind, Suggestion, ViewBox } from "./types";

const CANVAS_COVERAGE_THRESHOLD = 0.98;
const SPECK_MM2 = 1.5;
const SATIN_ASPECT_MIN = 4.0;
const SATIN_WIDTH_MM_MAX = 5.0;
const RUNNING_WIDTH_MM_MAX = 0.6;

export function buildPathRecord(
  raw: RawPath,
  index: number,
  viewBox: ViewBox,
  mmPerPx: number,
): PathRecord {
  const bbox = axisAlignedBbox(raw.subpaths);
  const areaPx = absoluteArea(raw.subpaths);
  const obb = orientedBbox(raw.subpaths);

  const areaMm2 = areaPx * mmPerPx * mmPerPx;
  const widthMm = obb.widthPx * mmPerPx;
  const lengthMm = obb.lengthPx * mmPerPx;
  const aspectRatio = widthMm > 0 ? lengthMm / widthMm : Infinity;

  const viewBoxArea = viewBox.w * viewBox.h || 1;
  const coversCanvas = areaPx / viewBoxArea >= CANVAS_COVERAGE_THRESHOLD;

  const suggestion = suggest({
    coversCanvas,
    layerIndex: raw.layerIndex,
    areaMm2,
    aspectRatio,
    widthMm,
    lengthMm,
  });

  return {
    index,
    d: raw.d,
    layerIndex: raw.layerIndex,
    fillColor: raw.fillColor,
    bboxPx: bbox,
    areaPx,
    areaMm2,
    obbWidthMm: widthMm,
    obbLengthMm: lengthMm,
    aspectRatio,
    principalAngleDeg: obb.angleDeg,
    coversCanvas,
    suggestion,
    subpaths: raw.subpaths,
  };
}

type SuggestInput = {
  coversCanvas: boolean;
  layerIndex: number;
  areaMm2: number;
  aspectRatio: number;
  widthMm: number;
  lengthMm: number;
};

function suggest(m: SuggestInput): Suggestion {
  if (m.coversCanvas && m.layerIndex === 0) {
    return { stitch_type: "skip", reason: "bottom-layer full-canvas background" };
  }
  if (m.areaMm2 < SPECK_MM2) {
    return {
      stitch_type: "skip",
      reason: `area ${m.areaMm2.toFixed(2)}mm² < ${SPECK_MM2}mm² speck`,
    };
  }
  if (m.aspectRatio >= SATIN_ASPECT_MIN && m.widthMm <= SATIN_WIDTH_MM_MAX) {
    return {
      stitch_type: "satin",
      reason: `aspect ${m.aspectRatio.toFixed(1)}:1, width ${m.widthMm.toFixed(2)}mm`,
    };
  }
  if (m.widthMm <= RUNNING_WIDTH_MM_MAX) {
    return {
      stitch_type: "running",
      reason: `width ${m.widthMm.toFixed(2)}mm hair-thin`,
    };
  }
  const _fill: StitchKind = "fill";
  return { stitch_type: _fill, reason: "default solid region" };
}

function inBand(value: number, threshold: number, fraction: number): boolean {
  return (
    value >= threshold * (1 - fraction) && value <= threshold * (1 + fraction)
  );
}

// A path needs the AI's opinion when its geometry sits inside a soft band
// around one of the suggest() thresholds — the deterministic rule could go
// either way on these. Everything outside the bands is a confident
// classification and bypasses the AI. Width-based bands are narrower for
// satin (±20%) and wider for running (±50%) because the 0–0.6mm range is
// otherwise too tight to slice usefully.
export function isAmbiguousStitchType(record: PathRecord): boolean {
  if (record.suggestion.stitch_type === "skip") return false;
  return (
    inBand(record.aspectRatio, SATIN_ASPECT_MIN, 0.2) ||
    inBand(record.obbWidthMm, SATIN_WIDTH_MM_MAX, 0.2) ||
    inBand(record.obbWidthMm, RUNNING_WIDTH_MM_MAX, 0.5)
  );
}

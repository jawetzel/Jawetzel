import { parseSvg } from "./analyze-svg";
import { buildPathRecord } from "./prefilter";
import type { PathRecord, ViewBox } from "./types";

export const DEFAULT_EMBROIDERY_DPI = 62.5;
export const INCH_MM = 25.4;

export { stripPaths } from "./strip-paths";
export type { PathRecord, ViewBox, StitchKind, Suggestion, Subpath, Point, Bbox } from "./types";

export type GeometryReport = {
  viewBox: ViewBox;
  dpi: number;
  mmPerPx: number;
  paths: PathRecord[];
};

export type AnalyzeOptions = {
  dpi?: number;
};

export function analyzeSvg(
  svgBytes: Uint8Array,
  options: AnalyzeOptions = {},
): GeometryReport {
  const dpi = options.dpi ?? DEFAULT_EMBROIDERY_DPI;
  const mmPerPx = INCH_MM / dpi;
  const svgText = new TextDecoder().decode(svgBytes);
  const { viewBox, rawPaths } = parseSvg(svgText);
  const paths = rawPaths.map((r, i) => buildPathRecord(r, i, viewBox, mmPerPx));
  return { viewBox, dpi, mmPerPx, paths };
}

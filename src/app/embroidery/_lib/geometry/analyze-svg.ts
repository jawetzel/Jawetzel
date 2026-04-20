import { IDENTITY, parseD, parseTransform, type Affine } from "./path-parser";
import type { Subpath, ViewBox } from "./types";

export type RawPath = {
  d: string;
  layerIndex: number;
  fillColor: string;
  transform: Affine;
  subpaths: Subpath[];
};

export type ParsedSvg = {
  viewBox: ViewBox;
  rawPaths: RawPath[];
};

// Assumes the worker's potrace output shape: flat, non-nested <g fill=... transform=...>
// groups containing self-closing <path d=.../> elements.
export function parseSvg(svgText: string): ParsedSvg {
  const viewBox = extractViewBox(svgText);
  const rawPaths: RawPath[] = [];

  const groupRe = /<g\b([^>]*)>([\s\S]*?)<\/g>/g;
  let layerIndex = 0;
  let gm: RegExpExecArray | null;
  while ((gm = groupRe.exec(svgText)) !== null) {
    const attrs = gm[1];
    const inner = gm[2];
    const fill = attr(attrs, "fill") ?? "#000000";
    const transform = parseTransform(attr(attrs, "transform"));

    const pathRe = /<path\b([^>]*?)\/>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pathRe.exec(inner)) !== null) {
      const d = attr(pm[1], "d");
      if (!d) continue;
      const subpaths = parseD(d, transform);
      rawPaths.push({ d, layerIndex, fillColor: fill, transform, subpaths });
    }
    layerIndex++;
  }

  // Fallback: paths outside any <g> (unusual for our pipeline, but don't drop them silently).
  if (rawPaths.length === 0) {
    const pathRe = /<path\b([^>]*?)\/>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pathRe.exec(svgText)) !== null) {
      const d = attr(pm[1], "d");
      if (!d) continue;
      const subpaths = parseD(d, IDENTITY);
      rawPaths.push({
        d,
        layerIndex: 0,
        fillColor: attr(pm[1], "fill") ?? "#000000",
        transform: IDENTITY,
        subpaths,
      });
    }
  }

  return { viewBox, rawPaths };
}

function extractViewBox(svg: string): ViewBox {
  const m = /viewBox\s*=\s*"([^"]+)"/.exec(svg);
  if (m) {
    const parts = m[1].split(/[\s,]+/).map(Number);
    return { x: parts[0] ?? 0, y: parts[1] ?? 0, w: parts[2] ?? 0, h: parts[3] ?? 0 };
  }
  const w = Number(/width\s*=\s*"(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);
  const h = Number(/height\s*=\s*"(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);
  return { x: 0, y: 0, w, h };
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
  const m = re.exec(attrs);
  return m ? m[1] : null;
}

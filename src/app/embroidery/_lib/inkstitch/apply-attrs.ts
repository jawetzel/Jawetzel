import type { PathRecord } from "../geometry";
import type { Thread } from "./gpl-palette";
import { snapToPalette } from "./thread-palette";

const INKSTITCH_NS = "http://inkstitch.org/namespace";

type StitchType = "fill" | "satin" | "running" | "skip";

export type AiPathDecision = {
  index: number;
  stitch_type: StitchType;
  fill_params?: Record<string, number>;
  satin_params?: Record<string, number>;
  running_params?: Record<string, number | string>;
  notes?: string;
};

export type ApplyAttrsOptions = {
  snapColors?: boolean;
  threadPalette?: Thread[];
  applyUnderlay?: boolean;
  underlayAreaMm2?: number;
  underlayRowSpacingMm?: number;
};

type ResolvedOptions = {
  snapColors: boolean;
  threadPalette: Thread[] | null;
  applyUnderlay: boolean;
  underlayAreaMm2: number;
  underlayRowSpacingMm: number;
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  snapColors: true,
  threadPalette: null,
  applyUnderlay: true,
  underlayAreaMm2: 10,
  underlayRowSpacingMm: 2.0,
};

export function applyInkstitchAttrs(
  svgBytes: Uint8Array,
  aiDecisions: AiPathDecision[],
  keptRecords: PathRecord[],
  options: ApplyAttrsOptions = {},
): Uint8Array {
  const opts: ResolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const decisionsByIndex = new Map<number, AiPathDecision>();
  for (const d of aiDecisions) decisionsByIndex.set(d.index, d);

  let svg = new TextDecoder().decode(svgBytes);

  svg = svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) =>
    attrs.includes("xmlns:inkstitch")
      ? `<svg${attrs}>`
      : `<svg${attrs} xmlns:inkstitch="${INKSTITCH_NS}">`,
  );

  // Ink/Stitch pops a wxPython "Update SVG version?" dialog whenever it sees
  // inkstitch:* attributes without a version tag — Xvfb has no one to click OK,
  // so /convert hangs forever. Inject the version metadata to skip that path.
  if (!svg.includes("inkstitch_svg_version")) {
    const metadata = `<metadata><inkstitch:inkstitch_svg_version>3</inkstitch:inkstitch_svg_version></metadata>\n`;
    svg = svg.replace(/(<svg\b[^>]*>)/, `$1\n${metadata}`);
  }

  let aiIndex = 0;
  svg = svg.replace(/<path\b([^>]*?)\/>\s*/g, (match, attrs: string) => {
    const idx = aiIndex++;
    const record = keptRecords[idx];
    if (!record) return match;

    const decision = decisionsByIndex.get(idx);
    const aiType: StitchType = decision?.stitch_type ?? record.suggestion.stitch_type;

    // AI is not allowed to drop paths — geometry prefilter already stripped
    // the noise. Any stray "skip" falls back to fill so the path survives.
    const effectiveType: "fill" | "satin" | "running" =
      aiType === "skip" ? "fill" : aiType;

    return buildPathElement(attrs, effectiveType, decision, record, opts) + "\n";
  });

  // Drop empty <g> wrappers left after stripping.
  svg = svg.replace(/<g\b[^>]*>\s*<\/g>\s*/g, "");

  if (opts.snapColors) {
    const pal = opts.threadPalette;
    svg = svg.replace(
      /(<g\b[^>]*?fill=")(#[0-9a-fA-F]{6})(")/g,
      (_, pre: string, hex: string, post: string) => {
        const snapped = pal ? snapToThreadPalette(hex, pal) : snapToPalette(hex).hex;
        return `${pre}${snapped}${post}`;
      },
    );
  }

  return new TextEncoder().encode(svg);
}

function buildPathElement(
  attrs: string,
  stitchType: "fill" | "satin" | "running",
  decision: AiPathDecision | undefined,
  record: PathRecord,
  opts: ResolvedOptions,
): string {
  const inkAttrs = buildInkstitchAttrs(stitchType, decision, record, opts);

  if (stitchType === "fill") {
    return `<path${attrs}${inkAttrs}/>`;
  }

  // Running / satin — override inherited fill with stroke-only styling so
  // Ink/Stitch treats the path as a stroke element.
  const color = record.fillColor;
  const strokeWidth = stitchType === "running" ? 1 : 3;
  const style = ` style="fill:none;stroke:${color};stroke-width:${strokeWidth}"`;
  return `<path${attrs}${style}${inkAttrs}/>`;
}

function buildInkstitchAttrs(
  stitchType: "fill" | "satin" | "running",
  decision: AiPathDecision | undefined,
  record: PathRecord,
  opts: ResolvedOptions,
): string {
  const out: string[] = [];

  if (stitchType === "fill") {
    const params = decision?.fill_params ?? {};
    // Fill runs perpendicular to the shape's long axis unless the AI overrode it.
    const angle = params.angle ?? (record.principalAngleDeg + 90) % 360;
    out.push(attr("angle", angle));

    for (const key of [
      "row_spacing_mm",
      "max_stitch_length_mm",
      "running_stitch_length_mm",
      "staggers",
      "expand_mm",
      "pull_compensation_mm",
    ] as const) {
      const v = params[key];
      if (v !== undefined) out.push(attr(key, v));
    }

    if (opts.applyUnderlay && record.areaMm2 >= opts.underlayAreaMm2) {
      out.push(attr("fill_underlay", "true"));
      out.push(attr("fill_underlay_row_spacing_mm", opts.underlayRowSpacingMm));
      out.push(attr("fill_underlay_angle", (angle + 90) % 360));
    }
  } else if (stitchType === "running") {
    const params = decision?.running_params ?? {};
    for (const key of [
      "running_stitch_length_mm",
      "bean_stitch_repeats",
      "max_stitch_length_mm",
    ] as const) {
      const v = params[key];
      if (v !== undefined) out.push(attr(key, v));
    }
  } else {
    const params = decision?.satin_params ?? {};
    // True satin columns need two-rail paths; potrace emits single-boundary fills,
    // so we approximate with zigzag stitch along the path.
    out.push(attr("method", "zigzag_stitch"));
    for (const key of [
      "zigzag_spacing_mm",
      "running_stitch_length_mm",
      "running_stitch_position",
      "short_stitch_inset",
      "short_stitch_distance_mm",
    ] as const) {
      const v = params[key];
      if (v !== undefined) out.push(attr(key, v));
    }
  }

  return out.length > 0 ? " " + out.join(" ") : "";
}

function attr(name: string, value: number | string): string {
  let v: string;
  if (typeof value === "number") {
    v = Number.isInteger(value) ? String(value) : value.toFixed(3);
  } else {
    v = value;
  }
  return `inkstitch:${name}="${v}"`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function snapToThreadPalette(hex: string, palette: Thread[]): string {
  const [r, g, b] = hexToRgb(hex);
  let best = palette[0];
  let bestD = Infinity;
  for (const t of palette) {
    const [tr, tg, tb] = hexToRgb(t.hex);
    const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best.hex;
}

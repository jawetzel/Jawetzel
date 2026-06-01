import type { PathRecord } from "@/domain/embroidery/geometry";
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

// Cluster → thread map produced by selectPalette. clusters[i] is a source-image
// pixel-cluster hex; routes[i] is the index into `threadPalette` the AI chose
// for that cluster, or -1 if the AI didn't route it.
export type ClusterRouting = {
  clusters: string[];
  routes: number[];
};

export type ApplyAttrsOptions = {
  snapColors?: boolean;
  threadPalette?: Thread[];
  clusterRouting?: ClusterRouting;
  applyUnderlay?: boolean;
  underlayAreaMm2?: number;
  underlayRowSpacingMm?: number;
};

type ResolvedOptions = {
  snapColors: boolean;
  threadPalette: Thread[] | null;
  clusterRouting: ClusterRouting | null;
  applyUnderlay: boolean;
  underlayAreaMm2: number;
  underlayRowSpacingMm: number;
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  snapColors: true,
  threadPalette: null,
  clusterRouting: null,
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

  // Same snapper used for the group-fill snap pass at the bottom. Built once
  // so stroke paths (running/satin) write their stroke-color in the
  // POST-SNAP thread hex, matching whatever the enclosing group will be
  // rewritten to. Without this they keep the trace-time color (e.g.
  // `stroke="#f7f9f8"` inside `<g fill="#ffffff">`) and inkstitch reads
  // them as a different thread, breaking the color stop and forcing an
  // extra machine color change for every fill↔stroke transition in the
  // same group.
  const snap = buildSnapper(options);

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

    return buildPathElement(attrs, effectiveType, decision, record, opts, snap) + "\n";
  });

  // Drop empty <g> wrappers left after stripping.
  svg = svg.replace(/<g\b[^>]*>\s*<\/g>\s*/g, "");

  if (opts.snapColors) {
    svg = svg.replace(
      /(<g\b[^>]*?fill=")(#[0-9a-fA-F]{6})(")/g,
      (_, pre: string, hex: string, post: string) =>
        `${pre}${snap(hex)}${post}`,
    );
  }

  return new TextEncoder().encode(svg);
}

// Exposed so callers can predict the post-snap fill color of any record
// without re-running applyInkstitchAttrs against the full SVG — used by the
// same-color enclosure dedupe pass, which needs to group paths by what their
// thread color will actually be, not the trace-time cluster centroid.
export function buildSnapper(
  options: ApplyAttrsOptions = {},
): (hex: string) => string {
  const opts: ResolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!opts.snapColors) return (h) => h;
  const pal = opts.threadPalette;
  const routing = opts.clusterRouting;
  const clusterToThread = new Map<string, string>();
  const routedClusters: { rgb: [number, number, number]; threadHex: string }[] = [];
  if (pal && routing) {
    for (let i = 0; i < routing.clusters.length; i++) {
      const route = routing.routes[i];
      if (route < 0 || route >= pal.length) continue;
      const cluster = routing.clusters[i].toLowerCase();
      const threadHex = pal[route].hex;
      clusterToThread.set(cluster, threadHex);
      routedClusters.push({ rgb: hexToRgb(routing.clusters[i]), threadHex });
    }
  }
  return (hex) => resolveFillColor(hex, clusterToThread, routedClusters, pal);
}

function buildPathElement(
  attrs: string,
  stitchType: "fill" | "satin" | "running",
  decision: AiPathDecision | undefined,
  record: PathRecord,
  opts: ResolvedOptions,
  snap: (hex: string) => string,
): string {
  const inkAttrs = buildInkstitchAttrs(stitchType, decision, record, opts);

  if (stitchType === "fill") {
    return `<path${attrs}${inkAttrs}/>`;
  }

  // Running / satin — override inherited fill with stroke-only styling so
  // Ink/Stitch treats the path as a stroke element. Stroke-width stays in
  // the worker's LOCAL coord system (each color group is wrapped in
  // `transform="scale(0.1, -0.1)"`); inkstitch reads it and interprets
  // accordingly. Earlier scaled-up widths (matched to obbWidthMm) blew up
  // visually because potrace emits CLOSED OUTLINES, not centerlines —
  // stroking a closed outline with `width = obbWidthMm` produces a thick
  // ring around the shape's perimeter and leaves the interior hollow. So
  // we keep the strokes thin in LOCAL coords. `vector-effect="non-
  // scaling-stroke"` is added so inkscape's bmp render shows the stroke
  // at viewport pixels (1 output-pixel-thick) regardless of the 0.1×
  // group transform, which would otherwise make `stroke-width:1` render
  // sub-pixel and invisible in the preview. (These widths are DPI-
  // independent because vector-effect short-circuits the transform.)
  //
  // CRITICAL: the stroke color is `snap(record.fillColor)`, not
  // `record.fillColor`. The trace's fillColor is the pre-snap cluster
  // centroid; the parent group's fill attribute will be rewritten to
  // the post-snap thread hex at the bottom of applyInkstitchAttrs. If
  // the stroke kept the pre-snap hex, inkstitch would see `stroke=…`
  // and `fill=…` as different threads and break the color stop. Pre-
  // snapping the stroke color keeps fills and strokes in the same
  // group at the same effective thread.
  const color = snap(record.fillColor);
  const strokeWidth = stitchType === "running" ? 1 : 3;
  const style = ` style="fill:none;stroke:${color};stroke-width:${strokeWidth}" vector-effect="non-scaling-stroke"`;
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

// Color-decision precedence: AI routing > nearest routed cluster > RGB-nearest
// thread. The earlier RGB-only snap was steamrolling the AI's semantic mapping
// (e.g. dark-pink outline cluster routed to dark-pink thread, but RGB-nearest
// then redirected to a closer light-pink thread because the cluster centroid
// happened to drift toward the lighter one).
function resolveFillColor(
  hex: string,
  clusterToThread: Map<string, string>,
  routedClusters: { rgb: [number, number, number]; threadHex: string }[],
  palette: Thread[] | null,
): string {
  const lower = hex.toLowerCase();
  // Trace stage already quantizes against the thread palette using the AI's
  // cluster routing, so traced.svg fills are real thread hexes. Running the
  // nearest-routed-cluster fallback on a thread hex routinely re-maps it to
  // the wrong thread — e.g. Black `#2f3032` is RGB-closest to a near-black
  // cluster centroid `#3d3a34` that the AI semantically routed to Gray, so
  // the snap turns Black into Gray. Short-circuit when the hex already is a
  // palette thread.
  if (palette && palette.some((t) => t.hex.toLowerCase() === lower)) return hex;
  const exact = clusterToThread.get(lower);
  if (exact) return exact;
  if (routedClusters.length > 0) {
    const [r, g, b] = hexToRgb(hex);
    let bestHex = routedClusters[0].threadHex;
    let bestD = Infinity;
    for (const c of routedClusters) {
      const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        bestHex = c.threadHex;
      }
    }
    return bestHex;
  }
  // Empty palette is a real case during debug runs (SKIP_AI_PALETTE at the
  // pipeline level skips the AI thread pick entirely and passes `threads: []`
  // through). `[]` is truthy, so a bare `if (palette)` falls through into
  // snapToThreadPalette and crashes reading palette[0].hex. Require at least
  // one thread before attempting a thread snap; otherwise use the generic
  // palette fallback.
  if (palette && palette.length > 0) return snapToThreadPalette(hex, palette);
  return snapToPalette(hex).hex;
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

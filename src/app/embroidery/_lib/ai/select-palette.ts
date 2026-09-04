import type { Thread } from "../inkstitch/gpl-palette";
import type { SelectedThread } from "@/domain/embroidery/thread";
import type {
  PaletteRouting,
  PaletteSelection,
} from "@/application/ports/embroidery-ai-gateway";
import { getLlmGateway } from "@/composition/llm";
import type { SampledColors } from "../worker";
import { SELECT_PALETTE_SYSTEM_PROMPT } from "./prompts";

type Pick = { number: string; role?: string };
// AI-supplied per-cluster route: cluster_hex -> thread_number.
type RouteEntry = { cluster_hex: string; thread_number: string; why?: string };
type PaletteResponse = {
  picks: Pick[];
  routing?: RouteEntry[];
  extract_outline?: boolean;
  rationale?: string;
};

// This step's output shapes are the contract `RunEmbroideryPipeline` injects
// against, so they are defined once in the application layer and re-exported
// here — the use-case must not import outward into `app/` to name its own
// collaborator's return type. `PaletteRouting` keeps its historical local name
// `ClusterRouting` for every consumer of this module.
export type { SelectedThread };
export type { PaletteSelection };
export type ClusterRouting = PaletteRouting;

// Lab-ΔE threshold for merging AI's near-duplicate thread picks. ADAPTIVE
// to the image's overall color complexity: a monochrome line-art design
// (cluster_spread ≈ 80) considers ΔE 15 a real distinction; a high-
// contrast rich illustration (cluster_spread ≈ 400) considers everything
// under ΔE 40 to be "shades of the same family." The fraction below maps
// cluster_spread → merge ΔE, clamped so we never go below "perceptually
// indistinguishable" or above "obviously different hues."
const MERGE_LAB_DELTA_E_MIN = 15;
const MERGE_LAB_DELTA_E_MAX = 45;
const MERGE_LAB_DELTA_E_PER_SPREAD = 1 / 8;
const MERGE_LAB_DELTA_E_DEFAULT = 25; // used when /sample-colors didn't report a spread

function mergeDeltaEForSpread(clusterSpread: number | null | undefined): number {
  if (clusterSpread === null || clusterSpread === undefined || clusterSpread <= 0) {
    return MERGE_LAB_DELTA_E_DEFAULT;
  }
  const scaled = clusterSpread * MERGE_LAB_DELTA_E_PER_SPREAD;
  return Math.max(MERGE_LAB_DELTA_E_MIN, Math.min(MERGE_LAB_DELTA_E_MAX, scaled));
}

function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  // sRGB D65 → XYZ (D65 reference white).
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
  const xn = x / 0.95047;
  const yn = y;
  const zn = z / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDeltaE(a: [number, number, number], b: [number, number, number]): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

export async function selectPalette(
  pngUrl: string,
  available: Thread[],
  sampled: SampledColors | null = null,
  maxThreads = 12,
): Promise<PaletteSelection> {
  if (available.length === 0) throw new Error("No available threads provided to selectPalette");

  // Compact tabular representation: number | name | hex | R,G,B
  const tableLines = available.map((t) => {
    const r = parseInt(t.hex.slice(1, 3), 16);
    const g = parseInt(t.hex.slice(3, 5), 16);
    const b = parseInt(t.hex.slice(5, 7), 16);
    return `${t.number}\t${t.hex}\trgb(${r},${g},${b})\t${t.name}`;
  });
  const table =
    "number\thex\trgb\tname\n" + tableLines.join("\n");

  // Spread = max pairwise RGB distance among clusters, 0..~441. Anything
  // below ~150 is a low-contrast image — flat illustration in one warm tone,
  // monochrome line-art on tinted paper, etc. In those, the lightest cluster
  // IS part of the design, not a paper background to strip.
  const LOW_CONTRAST_THRESHOLD = 150;
  const isLowContrast =
    sampled !== null && sampled.cluster_spread > 0 && sampled.cluster_spread < LOW_CONTRAST_THRESHOLD;
  const lowContrastNote = isLowContrast
    ? `\n\n**LOW-CONTRAST IMAGE** — max pairwise RGB distance among clusters is only ${sampled!.cluster_spread}/441. There is no paper-white background here; the lightest cluster IS one of the design colors. Do NOT assign \`role: "background"\` to any pick. The background role triggers a hard strip in the trace stage — using it here would erase the lightest design region and the surviving threads would collapse into one muddy blob. Treat every pick as body/accent/shadow/highlight.\n\n`
    : "";

  // Full cluster set from /sample-colors at full-res. The AI is asked to
  // route every one of these to a specific thread — that's the apples-to-
  // apples mapping the trace stage will honor verbatim.
  const clusterSection = sampled && sampled.colors.length > 0
    ? "Image's pixel clusters — full-image sampling at the same resolution the trace will quantize. Route EVERY cluster below to a thread in your `picks`. Use semantic judgment: a gradient of greens inside one leaf should all route to the same green thread; a shadow inside the rose can route to a darker thread even if its RGB is closer to a lighter one. Look at the image to decide role, not just hex.\n\n```tsv\n" +
      "cluster_hex\trgb\tfraction\n" +
      sampled.colors
        .map(
          (c) =>
            `${c.hex}\trgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})\t${(c.fraction * 100).toFixed(1)}%`,
        )
        .join("\n") +
      "\n```\n\n" +
      `Total distinct RGB values in the raw image: ${sampled.total_distinct_colors.toLocaleString()}. ` +
      `Cluster color spread (max pairwise RGB distance): ${sampled.cluster_spread}/441. ` +
      `These ${sampled.colors.length} clusters are what the trace quantizer will actually bucket pixels into.${lowContrastNote}\n\n`
    : "";

  const userText =
    `MAX_THREADS: ${maxThreads}. This is the HARD CEILING on \`picks.length\` — never exceed it. But also: don't pad up to it. Pick the fewest threads that cleanly express the design; the system will reject responses with > ${maxThreads} picks and silently consolidate near-duplicate picks even within the limit, so spending picks on close-color variants is wasted budget.\n\n` +
    `Available threads (${available.length} total):\n\n` +
    "```tsv\n" +
    table +
    "\n```\n\n" +
    clusterSection +
    "Return JSON with `picks` (the thread subset you chose) AND `routing` (one entry per cluster above, mapping cluster_hex to thread_number). Routing is authoritative — the trace stage will use it verbatim for that cluster.";

  const raw = await getLlmGateway().generateJsonFromImage({
    model: "gpt-5.4-mini",
    temperature: 0,
    systemPrompt: SELECT_PALETTE_SYSTEM_PROMPT,
    userText,
    imageUrl: pngUrl,
  });
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as PaletteResponse).picks)
  ) {
    throw new Error("AI palette response missing `picks` array");
  }

  const byNumber = new Map<string, Thread>();
  for (const t of available) byNumber.set(t.number.trim(), t);

  // Raw AI picks, deduped against the available list.
  const aiSelected: SelectedThread[] = [];
  const seen = new Set<string>();
  for (const p of (parsed as PaletteResponse).picks) {
    const key = typeof p.number === "string" ? p.number.trim() : "";
    if (!key || seen.has(key)) continue;
    const thread = byNumber.get(key);
    if (!thread) continue; // AI picked a number not in the list; drop it
    seen.add(key);
    aiSelected.push({ ...thread, role: p.role });
  }

  if (aiSelected.length < 2) {
    throw new Error(
      `AI returned too few valid picks: ${JSON.stringify(parsed)}`,
    );
  }

  // Pre-build the AI's cluster→thread-number map. Used both for the
  // consolidation step (route counts inform which thread gets dropped
  // when the cap binds) and for the final route array.
  const aiRouteEntries = Array.isArray((parsed as PaletteResponse).routing)
    ? ((parsed as PaletteResponse).routing as RouteEntry[])
    : [];
  const routeByCluster = new Map<string, string>();
  for (const r of aiRouteEntries) {
    if (typeof r?.cluster_hex === "string" && typeof r?.thread_number === "string") {
      routeByCluster.set(r.cluster_hex.trim().toLowerCase(), r.thread_number.trim());
    }
  }
  const aiIdxByNumber = new Map<string, number>();
  aiSelected.forEach((t, i) => aiIdxByNumber.set(t.number.trim(), i));

  // CONSOLIDATION. Two passes:
  //   (1) Adaptive Lab-ΔE merge — fuse pairs whose Lab distance is below
  //       a threshold scaled to the image's overall color spread. Mono-
  //       chrome designs use a tight threshold; rich illustrations use
  //       a loose one. Union-find with chaining, so a transitively-close
  //       group (10 threads pairwise within ΔE 30) collapses to one
  //       cluster. When a pair merges, the HIGHER-COVERAGE thread wins
  //       — big regions absorb little ones, not vice versa.
  //   (2) Cap enforcement — if (1) didn't shrink below `maxThreads`,
  //       drop the surviving reps with the fewest routed clusters until
  //       we're at the cap, redirecting their clusters to the nearest-
  //       Lab survivor.

  // Per-pick coverage estimate: how many clusters the AI routed to each
  // pick. Used both as the union tie-breaker AND as the cap-drop signal.
  const routesPerAiIdx = new Array<number>(aiSelected.length).fill(0);
  for (const threadNum of routeByCluster.values()) {
    const aiIdx = aiIdxByNumber.get(threadNum);
    if (aiIdx !== undefined) routesPerAiIdx[aiIdx] += 1;
  }

  // Union-find over aiSelected indices: parent[i] is i's representative.
  // The rep is chosen by coverage (higher wins); ties break by lower
  // index so the result is deterministic.
  const parent = aiSelected.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (parent[c] !== r) {
      const next = parent[c];
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const merge = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const coverA = routesPerAiIdx[ra];
    const coverB = routesPerAiIdx[rb];
    // Higher coverage wins; tie → lower index.
    if (coverA > coverB || (coverA === coverB && ra < rb)) {
      parent[rb] = ra;
    } else {
      parent[ra] = rb;
    }
  };

  const labMergeThreshold = mergeDeltaEForSpread(sampled?.cluster_spread);
  const aiLabs = aiSelected.map((t) => hexToLab(t.hex));
  for (let i = 0; i < aiSelected.length; i++) {
    for (let j = i + 1; j < aiSelected.length; j++) {
      if (find(i) === find(j)) continue;
      if (labDeltaE(aiLabs[i], aiLabs[j]) < labMergeThreshold) merge(i, j);
    }
  }

  // Count cluster routes per representative AFTER the Lab merge has
  // settled — the rep is now the highest-coverage thread in each
  // merge group; we need its post-merge total for cap-drop ordering.
  const routesPerRep = new Map<number, number>();
  for (let i = 0; i < aiSelected.length; i++) {
    const rep = find(i);
    routesPerRep.set(rep, (routesPerRep.get(rep) ?? 0) + routesPerAiIdx[i]);
  }

  // Cap enforcement: drop reps with the fewest routed clusters until we're
  // at maxThreads. Redirect each victim to the nearest-Lab survivor among
  // the remaining reps, and credit the survivor with the victim's routes.
  let aliveReps = Array.from(
    new Set(aiSelected.map((_, i) => find(i))),
  );
  while (aliveReps.length > maxThreads) {
    aliveReps.sort(
      (a, b) => (routesPerRep.get(a) ?? 0) - (routesPerRep.get(b) ?? 0),
    );
    const victim = aliveReps[0];
    const survivors = aliveReps.slice(1);
    let bestSurvivor = survivors[0];
    let bestD = Infinity;
    for (const s of survivors) {
      const d = labDeltaE(aiLabs[victim], aiLabs[s]);
      if (d < bestD) {
        bestD = d;
        bestSurvivor = s;
      }
    }
    parent[victim] = bestSurvivor;
    routesPerRep.set(
      bestSurvivor,
      (routesPerRep.get(bestSurvivor) ?? 0) + (routesPerRep.get(victim) ?? 0),
    );
    routesPerRep.delete(victim);
    aliveReps = survivors;
  }

  // Build final `selected` in first-appearance order of each rep.
  const repToFinalIdx = new Map<number, number>();
  const selected: SelectedThread[] = [];
  for (let i = 0; i < aiSelected.length; i++) {
    const rep = find(i);
    if (!repToFinalIdx.has(rep)) {
      repToFinalIdx.set(rep, selected.length);
      selected.push(aiSelected[rep]);
    }
  }

  if (selected.length < 2) {
    throw new Error(
      `Palette consolidated below 2 threads (AI picks=${aiSelected.length}, ` +
        `maxThreads=${maxThreads}). Original picks: ` +
        JSON.stringify(aiSelected.map((t) => t.number)),
    );
  }

  const extractOutline =
    typeof (parsed as PaletteResponse).extract_outline === "boolean"
      ? ((parsed as PaletteResponse).extract_outline as boolean)
      : true; // default to outline extraction when AI omits the flag

  // Build the parallel (clusters, routes) arrays the worker expects. The
  // order must match `sampled.colors` — the worker's cluster_hex[i] is the
  // i-th sampled color, and routes[i] is the thread-index the AI chose.
  // Any cluster the AI didn't route (or routed to an unknown thread number)
  // gets -1, which the worker treats as "fall back to Lab-ΔE nearest".
  // Cluster routes go through the consolidation map: if the AI routed to
  // a thread that got merged, we redirect to whichever consolidated index
  // ended up holding that thread's representative.
  let routing: ClusterRouting | null = null;
  if (sampled && sampled.colors.length > 0) {
    const clusters: string[] = [];
    const routes: number[] = [];
    let aiRouted = 0;
    let fallback = 0;
    for (const c of sampled.colors) {
      clusters.push(c.hex);
      const threadNum = routeByCluster.get(c.hex.toLowerCase());
      let idx = -1;
      if (threadNum !== undefined) {
        const aiIdx = aiIdxByNumber.get(threadNum);
        if (aiIdx !== undefined) {
          const rep = find(aiIdx);
          idx = repToFinalIdx.get(rep) ?? -1;
        }
      }
      routes.push(idx);
      if (idx >= 0) aiRouted++;
      else fallback++;
    }
    routing = { clusters, routes, aiRouted, fallback };
  }

  // Tail the rationale with consolidation notes so callers/logs see what
  // happened. Cheap signal that the cap+merge combo did something, and
  // shows the adaptive ΔE threshold we used in case the result looks
  // wrong (too aggressive → bump MERGE_LAB_DELTA_E_MAX down; too sparse
  // → bump MERGE_LAB_DELTA_E_PER_SPREAD up).
  const consolidated = aiSelected.length - selected.length;
  const rationaleBase = (parsed as PaletteResponse).rationale ?? "";
  const rationale =
    consolidated > 0
      ? `${rationaleBase}${rationaleBase ? " " : ""}[Consolidated ${aiSelected.length} AI picks → ${selected.length} threads (Lab ΔE < ${labMergeThreshold.toFixed(1)}, coverage-priority merge; cap=${maxThreads}; cluster_spread=${sampled?.cluster_spread ?? "n/a"}).]`
      : rationaleBase || undefined;

  return {
    threads: selected,
    extractOutline,
    routing,
    rationale,
  };
}

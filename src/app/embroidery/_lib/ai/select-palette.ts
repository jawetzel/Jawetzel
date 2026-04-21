import type { Thread } from "../inkstitch/gpl-palette";
import { getOpenAI } from "@/lib/ai/client";
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

export type SelectedThread = Thread & { role?: string };

// Parallel arrays the worker expects: clusters[i] -> palette index routes[i].
// routes[i] = -1 means the AI didn't route this cluster; worker falls back
// to Lab-ΔE nearest thread for that entry.
export type ClusterRouting = {
  clusters: string[];
  routes: number[];
  aiRouted: number;
  fallback: number;
};

export type PaletteSelection = {
  threads: SelectedThread[];
  extractOutline: boolean;
  routing: ClusterRouting | null;
  rationale?: string;
};

export async function selectPalette(
  pngUrl: string,
  available: Thread[],
  sampled: SampledColors | null = null,
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
      `These ${sampled.colors.length} clusters are what the trace quantizer will actually bucket pixels into.\n\n`
    : "";

  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: "gpt-5.4",
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: SELECT_PALETTE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Available threads (${available.length} total):\n\n` +
              "```tsv\n" +
              table +
              "\n```\n\n" +
              clusterSection +
              "Return JSON with `picks` (the thread subset you chose) AND `routing` (one entry per cluster above, mapping cluster_hex to thread_number). Routing is authoritative — the trace stage will use it verbatim for that cluster.",
          },
          { type: "image_url", image_url: { url: pngUrl, detail: "high" } },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
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

  const selected: SelectedThread[] = [];
  const seen = new Set<string>();
  for (const p of (parsed as PaletteResponse).picks) {
    const key = typeof p.number === "string" ? p.number.trim() : "";
    if (!key || seen.has(key)) continue;
    const thread = byNumber.get(key);
    if (!thread) continue; // AI picked a number not in the list; drop it
    seen.add(key);
    selected.push({ ...thread, role: p.role });
  }

  if (selected.length < 2) {
    throw new Error(
      `AI returned too few valid picks: ${JSON.stringify(parsed)}`,
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
  let routing: ClusterRouting | null = null;
  if (sampled && sampled.colors.length > 0) {
    const threadIndexByNumber = new Map<string, number>();
    selected.forEach((t, i) => threadIndexByNumber.set(t.number.trim(), i));
    const rawRouting = Array.isArray((parsed as PaletteResponse).routing)
      ? ((parsed as PaletteResponse).routing as RouteEntry[])
      : [];
    // Build a lookup: normalized cluster_hex -> thread_number.
    const routeByCluster = new Map<string, string>();
    for (const r of rawRouting) {
      if (typeof r?.cluster_hex === "string" && typeof r?.thread_number === "string") {
        routeByCluster.set(r.cluster_hex.trim().toLowerCase(), r.thread_number.trim());
      }
    }
    const clusters: string[] = [];
    const routes: number[] = [];
    let aiRouted = 0;
    let fallback = 0;
    for (const c of sampled.colors) {
      clusters.push(c.hex);
      const threadNum = routeByCluster.get(c.hex.toLowerCase());
      const idx = threadNum !== undefined ? threadIndexByNumber.get(threadNum) ?? -1 : -1;
      routes.push(idx);
      if (idx >= 0) aiRouted++;
      else fallback++;
    }
    routing = { clusters, routes, aiRouted, fallback };
  }

  return {
    threads: selected,
    extractOutline,
    routing,
    rationale: (parsed as PaletteResponse).rationale,
  };
}

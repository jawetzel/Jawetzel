import type { Thread } from "../inkstitch/gpl-palette";
import { getOpenAI } from "./client";
import { SELECT_PALETTE_SYSTEM_PROMPT } from "./prompts";

type Pick = { number: string; role?: string };
type PaletteResponse = {
  picks: Pick[];
  extract_outline?: boolean;
  rationale?: string;
};

export type SelectedThread = Thread & { role?: string };

export type PaletteSelection = {
  threads: SelectedThread[];
  extractOutline: boolean;
  rationale?: string;
};

export async function selectPalette(
  pngUrl: string,
  available: Thread[],
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
              "Pick the smallest subset that matches the design. Return JSON with `picks` (array of {number, role}).",
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
  return {
    threads: selected,
    extractOutline,
    rationale: (parsed as PaletteResponse).rationale,
  };
}

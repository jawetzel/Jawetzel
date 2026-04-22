#!/usr/bin/env node
/**
 * Extract Sulky's published RGB values from their `Sulky_rgb-Values_21.pdf`
 * (downloaded from sulky.com's free-downloads page) into a palette JSON we
 * can merge into the master thread-color map.
 *
 * Row format on each page:
 *   [article #]  [description]  [R]  [G]  [B]  [color name]
 * e.g. "942-0502 | 40WT 250YDS, CORNSILK | 239 | 200 | 16 | Cornsilk-ish label"
 *
 * Article # format is "942-XXXX" where the suffix is the Sulky color number.
 * All rows in this particular PDF are 40WT Rayon, so they all map to the
 * `sulky-rayon` palette key.
 *
 * Run:  node scripts/extract-sulky-rgb.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const PDF_PATH = ".sulky-pdfs/sulky-rgb-values.pdf";
const OUT_PATH = "src/data/thread-palettes/sulky-rayon-rgb.json";
const PALETTE_KEY = "sulky-rayon";

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function stripLeadingZeros(s) {
  if (!/^\d+$/.test(s)) return s;
  const stripped = s.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : "0";
}

async function extract() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(PDF_PATH));
  const doc = await pdfjs.getDocument({ data }).promise;

  const entries = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();

    const byY = new Map();
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: Math.round(it.transform[4]), str: it.str });
    }

    for (const items of byY.values()) {
      items.sort((a, b) => a.x - b.x);
      // Row must have an SKU like "942-XXXX"
      const sku = items.find((i) => /^\d{3}-\w+$/.test(i.str));
      if (!sku) continue;

      // Extract RGB values — column x-positions cluster around
      //   R ≈ 333-381, G ≈ 381-438, B ≈ 438-501
      // Just collect numeric-only strings right of the description.
      const nums = items
        .filter((i) => /^\d{1,3}$/.test(i.str))
        .map((i) => ({ x: i.x, n: parseInt(i.str, 10) }));
      // The RGB triplet is the 3 rightmost numeric values
      if (nums.length < 3) continue;
      const [r, g, b] = nums.slice(-3).map((n) => n.n);

      const colorNumber = sku.str.split("-")[1];
      const description = items
        .filter((i) => i.x > sku.x && !/^\d{1,3}$/.test(i.str))
        .map((i) => i.str)
        .join(" ")
        .trim();

      entries.push({
        color_number: stripLeadingZeros(colorNumber),
        raw_color_number: colorNumber,
        sku: sku.str,
        description,
        r,
        g,
        b,
        hex: rgbToHex(r, g, b),
      });
    }
  }

  return entries;
}

async function main() {
  console.log(`Extracting ${PDF_PATH}...`);
  const entries = await extract();
  console.log(`Parsed ${entries.length} entries`);

  // Dedupe by color_number (same color across sizes is one entry)
  const byColor = new Map();
  for (const e of entries) {
    if (!byColor.has(e.color_number)) byColor.set(e.color_number, e);
  }
  const unique = [...byColor.values()].sort((a, b) =>
    a.color_number.localeCompare(b.color_number, "en", { numeric: true }),
  );
  console.log(`Unique color numbers: ${unique.length}`);

  const output = {
    source: "sulky-rgb-values-pdf",
    source_url:
      "https://store-8ydwjl7b41.mybigcommerce.com/content/Resources%20Inspiration/Downloads%20thread/Sulky_rgb-Values_21.pdf",
    palette_key: PALETTE_KEY,
    generated_at: new Date().toISOString(),
    entry_count: unique.length,
    entries: unique,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUT_PATH}`);

  // Spot-check: print first 5 and a couple known colors
  console.log("\nSpot checks:");
  for (const e of unique.slice(0, 3))
    console.log(`  ${e.color_number} → ${e.hex} (${e.description})`);
  const black = unique.find((e) => /BLACK/i.test(e.description));
  if (black) console.log(`  BLACK: ${black.color_number} → ${black.hex}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

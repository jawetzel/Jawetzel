#!/usr/bin/env node
/**
 * Extract thread-color crossmatch tables from Gunold's public-facing PDF
 * catalogs into a normalized JSON dataset we can use for hex enrichment.
 *
 * Source PDFs live under `.crossmatch-pdfs/` (downloaded from
 * https://s3.amazonaws.com/assets-gunoldusa/media/media/Downloads/).
 *
 * Each PDF is a 2- or 3-column table with rows like
 *   [<source_number>] [<target_number>] [<source_number>] [<target_number>] ...
 * and a header row declaring the brand labels (e.g. "PMS" / "Gunold Poly",
 * or "Madeira" / "Gunold Sulky"). Items share a y-coordinate per row.
 *
 * Output: one JSON file per crossmatch at `src/data/thread-crossmatch/*.json`
 * in the shape:
 *   {
 *     "source_brand": "pantone-pms",
 *     "target_brand": "gunold-polyester",
 *     "mappings": [ { "source": "108", "target": "61187" }, ... ]
 *   }
 *
 * Run:  node scripts/extract-crossmatches.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PDF_DIR = ".crossmatch-pdfs";
const OUT_DIR = "src/data/thread-crossmatch";

// Human-friendly labels as they appear in the header of each PDF, mapped
// to the canonical brand keys we use internally. Note: the compact header
// row inside the table rarely tells us sub-line (e.g. it says "Madeira" not
// "Madeira Polyneon"). We ALSO parse the PDF title text (see TITLE_ALIASES)
// to refine this when possible.
const BRAND_ALIASES = {
  "PMS": "pantone-pms",
  "Pantone": "pantone-pms",
  "Madeira": "madeira",
  "Gunold Poly": "gunold-polyester",
  "Gunold Sulky": "sulky",
  "Sulky": "sulky",
  "Isacord": "isacord-polyester",
  "Ackermann Isacord": "isacord-polyester",
  "Robison-Anton": "robison-anton-polyester",
  "Robison Anton SuperBrite": "robison-anton-polyester",
  "Robison Anton": "robison-anton-polyester",
};

// Sub-line qualifiers extracted from PDF titles like "Madeira Poly Neon",
// "Madeira Rayon / Gunold Sulky". Each regex is run against the title; the
// first matching pair gives (source_sub, target_sub) overrides for the
// generic brand labels we pulled from the table header.
const TITLE_RULES = [
  // "Madeira Poly Neon / Gunold Poly" → madeira-polyneon / gunold-polyester
  { re: /Madeira\s*Poly\s*Neon/i, brand: "madeira", refinedKey: "madeira-polyneon" },
  { re: /Madeira\s*Rayon/i, brand: "madeira", refinedKey: "madeira-rayon" },
  { re: /Madeira\s*Classic/i, brand: "madeira", refinedKey: "madeira-rayon" },
  { re: /Madeira\s*Burmilana/i, brand: "madeira", refinedKey: "madeira-burmilana" },
  { re: /Madeira\s*Matt/i, brand: "madeira", refinedKey: "madeira-matt" },
  // "Gunold Sulky" in Gunold's labels means Sulky rayon. The titles
  // typically say "Madeira Rayon / Gunold Sulky" or similar — since the
  // crosswalk is for rayon, the Sulky side should map to sulky-rayon.
  { re: /Gunold\s*Sulky/i, brand: "sulky", refinedKey: "sulky-rayon" },
  { re: /Sulky\s*Rayon/i, brand: "sulky", refinedKey: "sulky-rayon" },
  { re: /Sulky\s*Polyester/i, brand: "sulky", refinedKey: "sulky-polyester" },
];

function normalizeBrand(label) {
  const trimmed = label.trim();
  if (BRAND_ALIASES[trimmed]) return BRAND_ALIASES[trimmed];
  // Loose fallback: case-insensitive substring match
  const lower = trimmed.toLowerCase();
  for (const [k, v] of Object.entries(BRAND_ALIASES)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return trimmed.toLowerCase().replace(/\s+/g, "-");
}

function isNumberLike(s) {
  // Accept thread color numbers like "108", "61187", "0502", "N1977", "5-130"
  return /^[\w-]{2,8}$/.test(s) && /\d/.test(s);
}

async function extractPdf(pdfPath, pdfjs) {
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const str = it.str.trim();
      if (!str || str === "•") continue;
      items.push({
        page: p,
        x: it.transform[4],
        y: Math.round(it.transform[5] * 10) / 10,
        str,
      });
    }
  }
  return items;
}

/**
 * Find the header row (brand labels) per page and learn the column layout.
 * Returns an array of column definitions like
 *   [{ xStart, xEnd, role: "source" | "target", brand: "madeira" }, ...]
 * The header row is the one where most items match a known brand alias.
 */
function detectColumns(items, page) {
  const pageItems = items.filter((it) => it.page === page);

  // Group by y
  const byY = new Map();
  for (const it of pageItems) {
    const key = it.y;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(it);
  }

  // Score each y-row by how many of its items match a known brand
  let bestRow = null;
  let bestScore = -1;
  for (const [y, rowItems] of byY) {
    // Concatenate adjacent items (some brands span multiple text objects:
    // "Gunold" + " " + "Poly" at different x positions but same y)
    const combined = combineAdjacent(rowItems);
    const matches = combined.filter((c) => BRAND_ALIASES[c.str]);
    if (matches.length > bestScore) {
      bestScore = matches.length;
      bestRow = combined;
    }
  }

  if (!bestRow || bestScore < 2) return null;

  // Build column definitions from the header row, alternating source/target.
  // Each column occupies [x, nextX) horizontally on the data rows below.
  const brands = bestRow
    .filter((c) => BRAND_ALIASES[c.str])
    .sort((a, b) => a.x - b.x);

  const cols = [];
  for (let i = 0; i < brands.length; i++) {
    const xStart = brands[i].x - 20;
    const xEnd = i + 1 < brands.length ? brands[i + 1].x - 20 : Infinity;
    cols.push({
      xStart,
      xEnd,
      role: i % 2 === 0 ? "source" : "target",
      brand: normalizeBrand(brands[i].str),
    });
  }
  return cols;
}

/**
 * Some header brand labels are split across two text objects at the same y
 * but adjacent x (e.g. "Gunold" + "Poly"). Merge them into a single item
 * with the leftmost x so the brand-alias lookup finds them.
 */
function combineAdjacent(rowItems) {
  const sorted = [...rowItems].sort((a, b) => a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && it.x - last.xEnd < 50 && !BRAND_ALIASES[last.str]) {
      // Try combining
      const combined = `${last.str} ${it.str}`.replace(/\s+/g, " ").trim();
      last.str = combined;
      last.xEnd = it.x + 30;
      continue;
    }
    out.push({ str: it.str, x: it.x, xEnd: it.x + 30 });
  }
  return out;
}

/**
 * Group data rows (non-header) by y-coord and for each row bucket values
 * into columns by x. Returns flat list of { source, target } pairs.
 */
function extractMappings(items, page, cols, headerY) {
  const pageItems = items.filter(
    (it) => it.page === page && it.y < headerY - 3,
  );

  const byY = new Map();
  for (const it of pageItems) {
    if (!isNumberLike(it.str)) continue;
    const key = it.y;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(it);
  }

  const mappings = [];
  for (const [y, rowItems] of byY) {
    void y;
    // Assign each item to its column
    const byCol = new Map();
    for (const it of rowItems) {
      const colIdx = cols.findIndex((c) => it.x >= c.xStart && it.x < c.xEnd);
      if (colIdx < 0) continue;
      if (!byCol.has(colIdx)) byCol.set(colIdx, []);
      byCol.get(colIdx).push(it.str);
    }

    // Walk columns in pairs (source, target), (source, target), ...
    for (let i = 0; i + 1 < cols.length; i += 2) {
      if (cols[i].role !== "source" || cols[i + 1].role !== "target") continue;
      const sourceVals = byCol.get(i) ?? [];
      const targetVals = byCol.get(i + 1) ?? [];
      const pairs = Math.max(sourceVals.length, targetVals.length);
      for (let j = 0; j < pairs; j++) {
        const source = sourceVals[j];
        const target = targetVals[j];
        if (!source || !target) continue;
        mappings.push({ source, target });
      }
    }
  }
  return mappings;
}

/**
 * Look at all text items together (often the title lives on page 1 above
 * the table header) and run the TITLE_RULES to refine the generic brand
 * labels from the column header. Returns a map of `generic brand` →
 * `refined brand key` (e.g. { madeira: "madeira-polyneon" }).
 */
function refineBrandsFromTitle(items) {
  const fullText = items.map((it) => it.str).join(" ");
  const refined = {};
  for (const rule of TITLE_RULES) {
    if (rule.re.test(fullText)) {
      // Don't overwrite — first rule wins (they're ordered most-specific first).
      if (!refined[rule.brand]) refined[rule.brand] = rule.refinedKey;
    }
  }
  return refined;
}

function applyRefinements(cols, refined) {
  return cols.map((c) => ({
    ...c,
    brand: refined[c.brand] ?? c.brand,
  }));
}

async function processPdf(pdfPath, pdfjs) {
  const items = await extractPdf(pdfPath, pdfjs);
  if (items.length === 0) {
    console.warn(`  no items extracted`);
    return null;
  }

  const refined = refineBrandsFromTitle(items);

  // Find pages with a detectable header; use first as canonical source/target
  // brand pair (subsequent pages should repeat the same layout).
  const pageCount = Math.max(...items.map((it) => it.page));
  let canonicalCols = null;
  const allMappings = [];

  for (let p = 1; p <= pageCount; p++) {
    const rawCols = detectColumns(items, p);
    if (!rawCols) continue;
    const cols = applyRefinements(rawCols, refined);

    if (!canonicalCols) canonicalCols = cols;

    // Find the header y on this page
    const headerItem = items.find(
      (it) => it.page === p && BRAND_ALIASES[it.str],
    );
    if (!headerItem) continue;

    const pageMappings = extractMappings(items, p, cols, headerItem.y);
    allMappings.push(...pageMappings);
  }

  if (!canonicalCols || allMappings.length === 0) return null;

  const sourceCol = canonicalCols.find((c) => c.role === "source");
  const targetCol = canonicalCols.find((c) => c.role === "target");

  // Dedupe exact duplicates (some rows repeat in multi-column layouts)
  const seen = new Set();
  const unique = [];
  for (const m of allMappings) {
    const k = `${m.source}|${m.target}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(m);
  }

  return {
    source_brand: sourceCol.brand,
    target_brand: targetCol.brand,
    pages: pageCount,
    count: unique.length,
    mappings: unique,
  };
}

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  mkdirSync(OUT_DIR, { recursive: true });
  const pdfs = readdirSync(PDF_DIR).filter((f) => f.endsWith(".pdf"));
  console.log(`Processing ${pdfs.length} PDFs from ${PDF_DIR}...`);

  for (const pdf of pdfs) {
    const pdfPath = join(PDF_DIR, pdf);
    const baseName = pdf.replace(/\.pdf$/, "");
    console.log(`\n→ ${pdf}`);
    try {
      const result = await processPdf(pdfPath, pdfjs);
      if (!result) {
        console.warn(`  skipped — couldn't detect layout`);
        continue;
      }
      console.log(
        `  ${result.source_brand} → ${result.target_brand}: ${result.count} mappings across ${result.pages} pages`,
      );
      const outPath = join(OUT_DIR, `${baseName}.json`);
      writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(`  wrote ${outPath}`);
    } catch (err) {
      console.error(`  FAILED:`, err.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

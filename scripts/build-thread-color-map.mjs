#!/usr/bin/env node
/**
 * Build the master thread-color map — `(brand, color) → hex` — from two
 * input sources:
 *
 *   1. Every Ink/Stitch GPL palette under
 *      `src/app/embroidery/_lib/inkstitch/palettes/` (authoritative hex
 *      published by volunteer-maintained catalogs).
 *
 *   2. Crossmatch tables extracted from Gunold's public PDFs, under
 *      `src/data/thread-crossmatch/*.json` (relates two vendor brands by
 *      color number). We propagate hex from whichever side has a palette
 *      entry to the side that doesn't, so e.g. Madeira's Ink/Stitch palette
 *      lets us fill in Gunold Poly colors via the "Madeira ↔ Gunold Poly"
 *      crossmatch table.
 *
 * Output: `src/data/thread-color-map.json` (checked in, read at runtime by
 * `src/worker/jobs/compile-feeds.ts`).
 *
 * Run:  node scripts/build-thread-color-map.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const PALETTE_DIR = "src/app/embroidery/_lib/inkstitch/palettes";
const CUSTOM_PALETTE_DIR = "src/data/thread-palettes";
const CROSSMATCH_DIR = "src/data/thread-crossmatch";
const OUTPUT_FILE = "src/data/thread-color-map.json";

function parseGpl(content) {
  const threads = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (
      line.startsWith("GIMP Palette") ||
      line.startsWith("Name:") ||
      line.startsWith("Columns:") ||
      line.startsWith("#")
    ) {
      continue;
    }
    const match = line.match(
      /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+(.+?)\s+(\S+)\s*$/,
    );
    if (!match) continue;
    const [, r, g, b, name, number] = match;
    const hex =
      "#" +
      [r, g, b]
        .map((c) => parseInt(c, 10).toString(16).padStart(2, "0"))
        .join("");
    threads.push({ hex, name: name.trim(), number });
  }
  return threads;
}

function keyOf(brand, number) {
  return `${brand}|${number}`;
}

function loadPalettes() {
  const files = readdirSync(PALETTE_DIR).filter((f) => f.endsWith(".gpl"));
  const entries = {};
  let totalThreads = 0;
  for (const file of files) {
    const brand = file.replace(/\.gpl$/, "");
    const content = readFileSync(join(PALETTE_DIR, file), "utf8");
    const threads = parseGpl(content);
    for (const t of threads) {
      const k = keyOf(brand, t.number);
      if (entries[k]) continue; // shouldn't happen within a palette, but guard
      entries[k] = {
        hex: t.hex,
        name: t.name,
        source: "ink-stitch",
      };
    }
    totalThreads += threads.length;
  }
  return { entries, paletteCount: files.length, totalThreads };
}

/**
 * Load custom palette JSON files. Two supported shapes:
 *
 *   A) Palette-style (e.g. Sulky RGB PDF extraction):
 *      { palette_key: "sulky-rayon", entries: [{ color_number, hex, ... }, ...] }
 *      These OVERRIDE Ink/Stitch entries for the same key since manufacturer-
 *      published RGBs are more authoritative than volunteer GPL palettes.
 *
 *   B) Direct-keyed (e.g. image-samples crawler output):
 *      { entries: { "Brand|Color": { hex, ... }, ... } }
 *      Keys are already in final `brand|color_number` form. Lowest priority —
 *      image sampling is noisier than any published palette, so these ONLY
 *      populate keys that no other source covers.
 */
function loadCustomPalettes(entries) {
  let files = [];
  try {
    files = readdirSync(CUSTOM_PALETTE_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return { fileCount: 0, added: 0, overrode: 0, imageSamples: 0 };
  }
  let added = 0;
  let overrode = 0;
  let imageSamples = 0;
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(CUSTOM_PALETTE_DIR, file), "utf8"));
    const fileSource = `custom:${file.replace(/\.json$/, "")}`;

    // Shape A — palette_key + entries array
    if (data.palette_key && Array.isArray(data.entries)) {
      for (const e of data.entries) {
        if (!e.color_number || !e.hex) continue;
        const k = keyOf(data.palette_key, e.color_number);
        const prev = entries[k];
        if (prev) overrode++;
        else added++;
        entries[k] = {
          hex: e.hex,
          name: e.description ?? e.name ?? prev?.name,
          source: fileSource,
        };
      }
      continue;
    }

    // Shape B — direct key → hex map (image samples, etc.). Never overrides
    // existing entries; fills only holes.
    if (data.entries && typeof data.entries === "object" && !Array.isArray(data.entries)) {
      for (const [k, v] of Object.entries(data.entries)) {
        if (!v?.hex) continue;
        if (entries[k]) continue; // lower priority — don't overwrite published palettes
        entries[k] = {
          hex: v.hex,
          name: v.name,
          source: fileSource,
          image_url: v.image_url,
          source_vendor: v.source_vendor,
        };
        imageSamples++;
      }
    }
  }
  return { fileCount: files.length, added, overrode, imageSamples };
}

function loadCrossmatches() {
  const files = readdirSync(CROSSMATCH_DIR).filter((f) => f.endsWith(".json"));
  const sets = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(CROSSMATCH_DIR, file), "utf8"));
    sets.push({ file, ...data });
  }
  return sets;
}

/**
 * Propagate hex across brands using crossmatch tables. For each mapping
 * `source → target`, if exactly one side has a known hex, copy it to the
 * other side (tagged with the crossmatch source). Stop when a full pass
 * produces no new entries — typically 1-2 passes is enough, but multi-hop
 * bridges (A↔B, B↔C) may need more.
 */
function propagateCrossmatches(entries, crossmatches) {
  let added = 0;
  let passes = 0;
  while (true) {
    passes++;
    let thisPass = 0;
    for (const cm of crossmatches) {
      for (const { source, target } of cm.mappings) {
        const sKey = keyOf(cm.source_brand, source);
        const tKey = keyOf(cm.target_brand, target);
        const sEntry = entries[sKey];
        const tEntry = entries[tKey];

        if (sEntry && !tEntry) {
          entries[tKey] = {
            hex: sEntry.hex,
            name: sEntry.name,
            source: `crossmatch:${cm.file.replace(/\.json$/, "")}`,
            derived_from: sKey,
          };
          thisPass++;
        } else if (!sEntry && tEntry) {
          entries[sKey] = {
            hex: tEntry.hex,
            name: tEntry.name,
            source: `crossmatch:${cm.file.replace(/\.json$/, "")}`,
            derived_from: tKey,
          };
          thisPass++;
        }
      }
    }
    added += thisPass;
    if (thisPass === 0) break;
    if (passes > 5) break; // safety
  }
  return { added, passes };
}

function main() {
  console.log("Loading Ink/Stitch palettes...");
  const { entries, paletteCount, totalThreads } = loadPalettes();
  const afterPalette = Object.keys(entries).length;
  console.log(
    `  ${paletteCount} palettes, ${totalThreads} thread entries parsed, ${afterPalette} unique (brand, color) keys`,
  );

  console.log("Loading custom palette extractions...");
  const custom = loadCustomPalettes(entries);
  console.log(
    `  ${custom.fileCount} custom palette files, ${custom.added} new + ${custom.overrode} overrides + ${custom.imageSamples} image-sampled`,
  );

  console.log("Loading crossmatches...");
  const crossmatches = loadCrossmatches();
  const totalMappings = crossmatches.reduce((a, c) => a + c.mappings.length, 0);
  console.log(`  ${crossmatches.length} crossmatch tables, ${totalMappings} mappings`);

  console.log("Propagating crossmatches...");
  const { added, passes } = propagateCrossmatches(entries, crossmatches);
  console.log(`  added ${added} entries across ${passes} passes`);

  // Stats by source
  const statsBySource = {};
  for (const entry of Object.values(entries)) {
    const key = entry.source.startsWith("crossmatch:") ? "crossmatch" : entry.source;
    statsBySource[key] = (statsBySource[key] || 0) + 1;
  }

  // Stats by brand
  const statsByBrand = {};
  for (const k of Object.keys(entries)) {
    const brand = k.split("|")[0];
    statsByBrand[brand] = (statsByBrand[brand] || 0) + 1;
  }

  // Sort entries for stable output
  const sortedKeys = Object.keys(entries).sort();
  const sortedEntries = {};
  for (const k of sortedKeys) sortedEntries[k] = entries[k];

  const output = {
    generated_at: new Date().toISOString(),
    stats: {
      total: sortedKeys.length,
      by_source: statsBySource,
      by_brand: statsByBrand,
    },
    entries: sortedEntries,
  };

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_FILE}`);
  console.log(`  total keys: ${sortedKeys.length}`);
  console.log(`  by source:`, statsBySource);
  console.log(`  top brands:`);
  const topBrands = Object.entries(statsByBrand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [b, c] of topBrands) console.log(`    ${b}: ${c}`);
}

main();

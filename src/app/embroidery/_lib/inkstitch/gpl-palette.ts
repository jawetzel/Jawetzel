import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Thread = { hex: string; name: string; number: string };

// Full Ink/Stitch palette catalog (75 files) — sourced from
// https://github.com/inkstitch/inkstitch/tree/main/palettes. Upstream names
// like "InkStitch Madeira Polyneon.gpl" are normalized to kebab-case here
// ("madeira-polyneon.gpl") to match the existing convention.
//
// Each entry must be a literal `new URL("./palettes/<file>.gpl", import.meta.url)`
// — Turbopack can only emit and resolve sibling assets when the URL string is
// statically analyzable. A computed `${file}` template here silently collapses
// to the first alphabetically matching asset, so every loadPalette() returned
// admelody-polyester data regardless of manufacturer.
const MANUFACTURER_URLS: Record<string, URL> = {
  "admelody-polyester": new URL("./palettes/admelody-polyester.gpl", import.meta.url),
  "admelody-rayon": new URL("./palettes/admelody-rayon.gpl", import.meta.url),
  "anchor": new URL("./palettes/anchor.gpl", import.meta.url),
  "arc-polyester": new URL("./palettes/arc-polyester.gpl", import.meta.url),
  "arc-rayon": new URL("./palettes/arc-rayon.gpl", import.meta.url),
  "aurifil-lana": new URL("./palettes/aurifil-lana.gpl", import.meta.url),
  "aurifil-mako": new URL("./palettes/aurifil-mako.gpl", import.meta.url),
  "aurifil-polyester": new URL("./palettes/aurifil-polyester.gpl", import.meta.url),
  "aurifil-rayon": new URL("./palettes/aurifil-rayon.gpl", import.meta.url),
  "aurifil-royal": new URL("./palettes/aurifil-royal.gpl", import.meta.url),
  "bfc-polyester": new URL("./palettes/bfc-polyester.gpl", import.meta.url),
  "brildor-ac": new URL("./palettes/brildor-ac.gpl", import.meta.url),
  "brildor-co": new URL("./palettes/brildor-co.gpl", import.meta.url),
  "brildor-mf": new URL("./palettes/brildor-mf.gpl", import.meta.url),
  "brildor-ny": new URL("./palettes/brildor-ny.gpl", import.meta.url),
  "brildor-pb": new URL("./palettes/brildor-pb.gpl", import.meta.url),
  "brother-country": new URL("./palettes/brother-country.gpl", import.meta.url),
  "brother-embroidery": new URL("./palettes/brother-embroidery.gpl", import.meta.url),
  "brothread-40": new URL("./palettes/brothread-40.gpl", import.meta.url),
  "brothread-80": new URL("./palettes/brothread-80.gpl", import.meta.url),
  "coats-alcazar-jazz": new URL("./palettes/coats-alcazar-jazz.gpl", import.meta.url),
  "coats-alcazar": new URL("./palettes/coats-alcazar.gpl", import.meta.url),
  "coats-sylko-usa": new URL("./palettes/coats-sylko-usa.gpl", import.meta.url),
  "coats-sylko": new URL("./palettes/coats-sylko.gpl", import.meta.url),
  "dmc": new URL("./palettes/dmc.gpl", import.meta.url),
  "embroidex": new URL("./palettes/embroidex.gpl", import.meta.url),
  "emmel": new URL("./palettes/emmel.gpl", import.meta.url),
  "fil-tec-glide": new URL("./palettes/fil-tec-glide.gpl", import.meta.url),
  "floriani-polyester": new URL("./palettes/floriani-polyester.gpl", import.meta.url),
  "fufu-polyester": new URL("./palettes/fufu-polyester.gpl", import.meta.url),
  "fufu-rayon": new URL("./palettes/fufu-rayon.gpl", import.meta.url),
  "gunold-polyester": new URL("./palettes/gunold-polyester.gpl", import.meta.url),
  "gutermann-creativ-dekor": new URL("./palettes/gutermann-creativ-dekor.gpl", import.meta.url),
  "hemingworth": new URL("./palettes/hemingworth.gpl", import.meta.url),
  "isacord-polyester": new URL("./palettes/isacord-polyester.gpl", import.meta.url),
  "isafil-rayon": new URL("./palettes/isafil-rayon.gpl", import.meta.url),
  "isalon-polyester": new URL("./palettes/isalon-polyester.gpl", import.meta.url),
  "janome": new URL("./palettes/janome.gpl", import.meta.url),
  "king-star": new URL("./palettes/king-star.gpl", import.meta.url),
  "madeira-burmilana": new URL("./palettes/madeira-burmilana.gpl", import.meta.url),
  "madeira-matt": new URL("./palettes/madeira-matt.gpl", import.meta.url),
  "madeira-polyneon": new URL("./palettes/madeira-polyneon.gpl", import.meta.url),
  "madeira-rayon": new URL("./palettes/madeira-rayon.gpl", import.meta.url),
  "magnifico": new URL("./palettes/magnifico.gpl", import.meta.url),
  "marathon-polyester": new URL("./palettes/marathon-polyester.gpl", import.meta.url),
  "marathon-rayon-v3": new URL("./palettes/marathon-rayon-v3.gpl", import.meta.url),
  "marathon-rayon": new URL("./palettes/marathon-rayon.gpl", import.meta.url),
  "metro": new URL("./palettes/metro.gpl", import.meta.url),
  "mettler-embroidery": new URL("./palettes/mettler-embroidery.gpl", import.meta.url),
  "mettler-poly-sheen": new URL("./palettes/mettler-poly-sheen.gpl", import.meta.url),
  "mtb-embroidex": new URL("./palettes/mtb-embroidex.gpl", import.meta.url),
  "outback-embroidery-rayon": new URL("./palettes/outback-embroidery-rayon.gpl", import.meta.url),
  "poly-x40": new URL("./palettes/poly-x40.gpl", import.meta.url),
  "princess": new URL("./palettes/princess.gpl", import.meta.url),
  "radiant-rayon": new URL("./palettes/radiant-rayon.gpl", import.meta.url),
  "ral": new URL("./palettes/ral.gpl", import.meta.url),
  "robison-anton-polyester": new URL("./palettes/robison-anton-polyester.gpl", import.meta.url),
  "robison-anton-rayon": new URL("./palettes/robison-anton-rayon.gpl", import.meta.url),
  "royal-polyester": new URL("./palettes/royal-polyester.gpl", import.meta.url),
  "royal-viscose-rayon": new URL("./palettes/royal-viscose-rayon.gpl", import.meta.url),
  "sigma": new URL("./palettes/sigma.gpl", import.meta.url),
  "simthread-glow-in-the-dark-15-colors": new URL("./palettes/simthread-glow-in-the-dark-15-colors.gpl", import.meta.url),
  "simthread-polyester-63-brother-colors": new URL("./palettes/simthread-polyester-63-brother-colors.gpl", import.meta.url),
  "simthread-polyester": new URL("./palettes/simthread-polyester.gpl", import.meta.url),
  "simthread-rayon": new URL("./palettes/simthread-rayon.gpl", import.meta.url),
  "sulky-polyester": new URL("./palettes/sulky-polyester.gpl", import.meta.url),
  "sulky-rayon": new URL("./palettes/sulky-rayon.gpl", import.meta.url),
  "swist-rayon": new URL("./palettes/swist-rayon.gpl", import.meta.url),
  "threadart": new URL("./palettes/threadart.gpl", import.meta.url),
  "tristar-polyester": new URL("./palettes/tristar-polyester.gpl", import.meta.url),
  "tristar-rayon": new URL("./palettes/tristar-rayon.gpl", import.meta.url),
  "viking-palette": new URL("./palettes/viking-palette.gpl", import.meta.url),
  "vyapar-rayon": new URL("./palettes/vyapar-rayon.gpl", import.meta.url),
  "wonderfil-polyester": new URL("./palettes/wonderfil-polyester.gpl", import.meta.url),
  "wonderfil-rayon": new URL("./palettes/wonderfil-rayon.gpl", import.meta.url),
};

export const DEFAULT_MANUFACTURER = "madeira-polyneon";

// Madeira's own 45-color starter kit (product #924-45, "Polyneon #60 Machine
// Embroidery Thread 45 Color Kit"). Manufacturer-curated essentials, not our
// opinion. Only defined for the default manufacturer — callers using a different
// catalog must supply their own `thread_numbers`, since we don't pretend to know
// what's essential across other vendors.
// Source: https://www.madeirausa.com/924-45-madeira-polyneon-60.html
const MADEIRA_POLYNEON_DEFAULT_NUMBERS: string[] = [
  "1624", "1637", "1642", "1670", "1673", "1678", "1682", "1723", "1725", "1738",
  "1747", "1750", "1756", "1765", "1791", "1800", "1801", "1803", "1811", "1812",
  "1816", "1835", "1840", "1841", "1842", "1843", "1845", "1851", "1866", "1874",
  "1918", "1922", "1924", "1934", "1944", "1945", "1955", "1966", "1970", "1971",
  "1973", "1977", "1981", "1984", "1988",
];

const DEFAULT_THREAD_NUMBERS: Record<string, string[]> = {
  "madeira-polyneon": MADEIRA_POLYNEON_DEFAULT_NUMBERS,
};

export function listManufacturers(): string[] {
  return Object.keys(MANUFACTURER_URLS);
}

function parseGpl(content: string): Thread[] {
  const threads: Thread[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("GIMP Palette") || line.startsWith("Name:") || line.startsWith("Columns:") || line.startsWith("#")) {
      continue;
    }
    // Each data line: "R G B    Name    Number"  (whitespace-separated, name can contain spaces)
    const match = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+(.+?)\s+(\S+)\s*$/);
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

const paletteCache = new Map<string, Thread[]>();

export function loadPalette(manufacturer: string = DEFAULT_MANUFACTURER): Thread[] {
  const key = manufacturer.toLowerCase();
  const cached = paletteCache.get(key);
  if (cached) return cached;
  const url = MANUFACTURER_URLS[key];
  if (!url) {
    throw new Error(
      `Unknown manufacturer palette '${manufacturer}'. Available: ${listManufacturers().join(", ")}`,
    );
  }
  const abs = fileURLToPath(url);
  const threads = parseGpl(readFileSync(abs, "utf8"));
  if (threads.length === 0) {
    throw new Error(`Palette file for '${key}' parsed to zero threads`);
  }
  paletteCache.set(key, threads);
  return threads;
}

export function filterAvailable(
  manufacturer: string,
  threads: Thread[],
  availableNumbers: string[] | null | undefined,
): Thread[] {
  if (availableNumbers && availableNumbers.length > 0) {
    const want = new Set(availableNumbers.map((n) => n.trim()));
    const picked = threads.filter((t) => want.has(t.number));
    if (picked.length === 0) {
      throw new Error(
        `None of the provided thread numbers matched this palette: ${availableNumbers.join(", ")}`,
      );
    }
    return picked;
  }
  const defaults = DEFAULT_THREAD_NUMBERS[manufacturer.toLowerCase()];
  if (!defaults) {
    throw new Error(
      `No built-in default thread set for '${manufacturer}'. Provide thread_numbers explicitly.`,
    );
  }
  const want = new Set(defaults);
  const picked = threads.filter((t) => want.has(t.number));
  if (picked.length === 0) {
    throw new Error(
      `Built-in default thread set for '${manufacturer}' matched zero threads — catalog file may be out of date.`,
    );
  }
  return picked;
}

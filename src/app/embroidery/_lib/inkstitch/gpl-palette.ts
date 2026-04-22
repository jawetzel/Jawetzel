import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Thread = { hex: string; name: string; number: string };

// Full Ink/Stitch palette catalog (75 files) — sourced from
// https://github.com/inkstitch/inkstitch/tree/main/palettes. Upstream names
// like "InkStitch Madeira Polyneon.gpl" are normalized to kebab-case here
// ("madeira-polyneon.gpl") to match the existing convention.
const MANUFACTURER_FILES: Record<string, string> = {
  "admelody-polyester": "admelody-polyester.gpl",
  "admelody-rayon": "admelody-rayon.gpl",
  "anchor": "anchor.gpl",
  "arc-polyester": "arc-polyester.gpl",
  "arc-rayon": "arc-rayon.gpl",
  "aurifil-lana": "aurifil-lana.gpl",
  "aurifil-mako": "aurifil-mako.gpl",
  "aurifil-polyester": "aurifil-polyester.gpl",
  "aurifil-rayon": "aurifil-rayon.gpl",
  "aurifil-royal": "aurifil-royal.gpl",
  "bfc-polyester": "bfc-polyester.gpl",
  "brildor-ac": "brildor-ac.gpl",
  "brildor-co": "brildor-co.gpl",
  "brildor-mf": "brildor-mf.gpl",
  "brildor-ny": "brildor-ny.gpl",
  "brildor-pb": "brildor-pb.gpl",
  "brother-country": "brother-country.gpl",
  "brother-embroidery": "brother-embroidery.gpl",
  "brothread-40": "brothread-40.gpl",
  "brothread-80": "brothread-80.gpl",
  "coats-alcazar-jazz": "coats-alcazar-jazz.gpl",
  "coats-alcazar": "coats-alcazar.gpl",
  "coats-sylko-usa": "coats-sylko-usa.gpl",
  "coats-sylko": "coats-sylko.gpl",
  "dmc": "dmc.gpl",
  "embroidex": "embroidex.gpl",
  "emmel": "emmel.gpl",
  "fil-tec-glide": "fil-tec-glide.gpl",
  "floriani-polyester": "floriani-polyester.gpl",
  "fufu-polyester": "fufu-polyester.gpl",
  "fufu-rayon": "fufu-rayon.gpl",
  "gunold-polyester": "gunold-polyester.gpl",
  "gutermann-creativ-dekor": "gutermann-creativ-dekor.gpl",
  "hemingworth": "hemingworth.gpl",
  "isacord-polyester": "isacord-polyester.gpl",
  "isafil-rayon": "isafil-rayon.gpl",
  "isalon-polyester": "isalon-polyester.gpl",
  "janome": "janome.gpl",
  "king-star": "king-star.gpl",
  "madeira-burmilana": "madeira-burmilana.gpl",
  "madeira-matt": "madeira-matt.gpl",
  "madeira-polyneon": "madeira-polyneon.gpl",
  "madeira-rayon": "madeira-rayon.gpl",
  "magnifico": "magnifico.gpl",
  "marathon-polyester": "marathon-polyester.gpl",
  "marathon-rayon-v3": "marathon-rayon-v3.gpl",
  "marathon-rayon": "marathon-rayon.gpl",
  "metro": "metro.gpl",
  "mettler-embroidery": "mettler-embroidery.gpl",
  "mettler-poly-sheen": "mettler-poly-sheen.gpl",
  "mtb-embroidex": "mtb-embroidex.gpl",
  "outback-embroidery-rayon": "outback-embroidery-rayon.gpl",
  "poly-x40": "poly-x40.gpl",
  "princess": "princess.gpl",
  "radiant-rayon": "radiant-rayon.gpl",
  "ral": "ral.gpl",
  "robison-anton-polyester": "robison-anton-polyester.gpl",
  "robison-anton-rayon": "robison-anton-rayon.gpl",
  "royal-polyester": "royal-polyester.gpl",
  "royal-viscose-rayon": "royal-viscose-rayon.gpl",
  "sigma": "sigma.gpl",
  "simthread-glow-in-the-dark-15-colors": "simthread-glow-in-the-dark-15-colors.gpl",
  "simthread-polyester-63-brother-colors": "simthread-polyester-63-brother-colors.gpl",
  "simthread-polyester": "simthread-polyester.gpl",
  "simthread-rayon": "simthread-rayon.gpl",
  "sulky-polyester": "sulky-polyester.gpl",
  "sulky-rayon": "sulky-rayon.gpl",
  "swist-rayon": "swist-rayon.gpl",
  "threadart": "threadart.gpl",
  "tristar-polyester": "tristar-polyester.gpl",
  "tristar-rayon": "tristar-rayon.gpl",
  "viking-palette": "viking-palette.gpl",
  "vyapar-rayon": "vyapar-rayon.gpl",
  "wonderfil-polyester": "wonderfil-polyester.gpl",
  "wonderfil-rayon": "wonderfil-rayon.gpl",
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
  return Object.keys(MANUFACTURER_FILES);
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
  const file = MANUFACTURER_FILES[key];
  if (!file) {
    throw new Error(
      `Unknown manufacturer palette '${manufacturer}'. Available: ${listManufacturers().join(", ")}`,
    );
  }
  // `new URL(relative, import.meta.url)` is the Next.js/webpack-blessed way to
  // reference a sibling asset so nft includes it in the deployed bundle. The
  // ./palettes/ folder ships alongside this compiled module.
  const abs = fileURLToPath(new URL(`./palettes/${file}`, import.meta.url));
  const threads = parseGpl(readFileSync(abs, "utf8"));
  if (threads.length === 0) {
    throw new Error(`Palette file ${file} parsed to zero threads`);
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

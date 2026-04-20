import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Thread = { hex: string; name: string; number: string };

const MANUFACTURER_FILES: Record<string, string> = {
  "madeira-polyneon": "madeira-polyneon.gpl",
  "madeira-rayon": "madeira-rayon.gpl",
  "dmc": "dmc.gpl",
  "isacord-polyester": "isacord-polyester.gpl",
  "robison-anton-polyester": "robison-anton-polyester.gpl",
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

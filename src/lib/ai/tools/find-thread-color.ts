/**
 * Tool: find up to 5 embroidery threads visually close to a target hex.
 *
 * The LLM is responsible for resolving color language ("mauve", "warm taupe")
 * to a hex before calling. Search is grounded in the live feed — only real
 * feed entries are returned, each with a deep link that lands on the
 * embroidery-supplies page pre-wired to the matched hex + tolerance.
 */

import {
  hexToRgb,
  rgbDistance,
  searchByHex,
  InvalidHexError,
  type HexMatch,
} from "@/lib/ai/embroidery-supplies/feeds";
import {
  SUPPLY_DEFAULT_TOLERANCE,
  SUPPLY_MAX_TOLERANCE,
  SUPPLY_TILE_MIN_SEPARATION,
  SUPPLY_TOLERANCE_RETRY_LADDER,
} from "@/lib/ai/embroidery-supplies/constants";

const MAX_TILES = 5;

export const findThreadColorTool = {
  type: "function" as const,
  function: {
    name: "find_thread_color",
    description:
      "Find real embroidery threads visually close to a target color. Use whenever the user asks for a color by name (e.g. 'mauve', 'forest green'), by hex, or by description ('a slightly warmer navy'). You must provide the hex — translate color language into a hex before calling. Returns up to 5 matches from the live vendor feed; each includes a deep_link the user can click to load the full comparison table pre-filtered to that hex.",
    parameters: {
      type: "object",
      properties: {
        hex: {
          type: "string",
          description:
            "6-digit hex color, with or without leading #. Examples: '#b784a7', 'c41e3a'.",
        },
        tolerance: {
          type: "number",
          description: `Euclidean RGB distance allowed when matching. Default ${SUPPLY_DEFAULT_TOLERANCE} (tight neighborhood — only visually near-identical threads). Widen through ${SUPPLY_TOLERANCE_RETRY_LADDER.slice(1).join(" then ")} if the first call returns no matches. Max ${SUPPLY_MAX_TOLERANCE}.`,
        },
      },
      required: ["hex"],
    },
  },
};

export interface FindThreadColorArgs {
  hex: string;
  tolerance?: number;
}

export interface ThreadMatchTile {
  hex: string;
  color_name: string | null;
  color_number: string;
  brand: string;
  manufacturer: string | null;
  shopping_source: string;
  length_yds: number | null;
  distance: number;
  cheapest_price: number | null;
  cheapest_vendor: string | null;
  deep_link: string;
}

export interface FindThreadColorResult {
  reference_hex: string;
  tolerance: number;
  matches: ThreadMatchTile[];
  note?: string;
}

function toTile(match: HexMatch): ThreadMatchTile {
  let cheapestPrice: number | null = null;
  let cheapestVendor: string | null = null;
  for (const [vendor, row] of Object.entries(match.vendors)) {
    if (row.price === null) continue;
    if (cheapestPrice === null || row.price < cheapestPrice) {
      cheapestPrice = row.price;
      cheapestVendor = vendor;
    }
  }
  const hexNoHash = (match.hex ?? "").replace(/^#/, "");
  return {
    hex: match.hex ?? "#000000",
    color_name: match.color_name,
    color_number: match.color_number,
    brand: match.brand,
    manufacturer: match.manufacturer,
    shopping_source: match.shopping_source,
    length_yds: match.length_yds,
    distance: match.distance,
    cheapest_price: cheapestPrice,
    cheapest_vendor: cheapestVendor,
    // Deep link always uses the page's default tolerance — the AI may
    // have widened its own search up to SUPPLY_MAX_TOLERANCE to find
    // something, but clicking through should land on the tight table
    // view the page users expect.
    deep_link: `/tools/embroidery-supplies?hex=${hexNoHash}&tol=${SUPPLY_DEFAULT_TOLERANCE}#thread-lookup`,
  };
}

export async function executeFindThreadColor(
  args: FindThreadColorArgs,
): Promise<FindThreadColorResult> {
  const tolerance = Math.min(
    SUPPLY_MAX_TOLERANCE,
    Math.max(
      1,
      args.tolerance !== undefined && !Number.isNaN(args.tolerance)
        ? args.tolerance
        : SUPPLY_DEFAULT_TOLERANCE,
    ),
  );

  let feedResult;
  try {
    feedResult = await searchByHex({ hex: args.hex, tolerance });
  } catch (err) {
    if (err instanceof InvalidHexError) {
      return {
        reference_hex: args.hex,
        tolerance,
        matches: [],
        note: `Invalid hex '${args.hex}'. Pass a 6-digit hex like '#b784a7'.`,
      };
    }
    throw err;
  }

  // Feed returns one row per (brand, color_number, length) — many share the
  // same or very similar hex. Walk the distance-sorted matches and keep
  // only those more than SUPPLY_TILE_MIN_SEPARATION from every tile we've
  // already kept. Same distance-based dedupe methodology as the
  // neighborhood strip, just tuned tight enough to return 5
  // slightly-varied options rather than 5 disjoint neighborhoods.
  const keptRgb: Array<{ r: number; g: number; b: number }> = [];
  const matches: ThreadMatchTile[] = [];
  for (const m of feedResult.matches) {
    if (!m.hex) continue;
    const rgb = hexToRgb(m.hex);
    if (!rgb) continue;
    const tooClose = keptRgb.some(
      (kept) => rgbDistance(kept, rgb) < SUPPLY_TILE_MIN_SEPARATION,
    );
    if (tooClose) continue;
    keptRgb.push(rgb);
    matches.push(toTile(m));
    if (matches.length >= MAX_TILES) break;
  }

  return {
    reference_hex: feedResult.reference_hex,
    tolerance,
    matches,
    ...(matches.length === 0 && {
      note: `No threads found within distance ${tolerance} of ${feedResult.reference_hex}. Retry with a wider tolerance (${SUPPLY_TOLERANCE_RETRY_LADDER.slice(1).join(" or ")}).`,
    }),
  };
}

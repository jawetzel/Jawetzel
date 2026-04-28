/**
 * Pure search/load helpers for the embroidery-supplies feed. Shared by the
 * HTTP search route (`/api/tools/embroidery-supplies/search`) and the AI
 * assistant's `find_thread_color` tool. Auth lives in the route; this module
 * is unauthenticated on purpose — callers that need to gate access gate it
 * themselves.
 *
 * Feeds are loaded from R2 once and cached at module scope for 10 minutes.
 * A refresh job rewrites `supplies/products/current.json` and
 * `supplies/listings/current.json`; the next cache miss picks them up.
 */

import { downloadFromR2 } from "@/lib/r2";
import type {
  Listing,
  ListingsFeed,
  Material,
  Product,
  ProductsFeed,
} from "@/worker/jobs/compile-feeds";

export const CACHE_TTL_MS = 10 * 60 * 1000;
// Tight by default — image-sampled hexes have some noise, but 5 RGB covers
// that without pulling in neighboring color families. Callers can loosen
// via `tolerance` when they want a wider sweep.
export const DEFAULT_HEX_TOLERANCE = 5;
export const MAX_CANDIDATES = 100;
export const MAX_HEX_MATCHES = 200;

export type FeedCache = {
  loadedAt: number;
  products: Record<string, Product>;
  /** Map<product_key, Map<shopping_source, listing>> — built once at
   *  cache-load from the flat listings array for O(1) per-shop lookup. */
  listingsByProduct: Map<string, Map<string, Listing>>;
};

export type PublicListing = {
  price: number | null;
  cost: number | null;
  qty: number | null;
  url: string | null;
};

/**
 * Public-facing search result — a Product joined with its listings. Listings
 * are keyed by `shopping_source` (the canonical retailer label) so the UI
 * and AI tool consume the same names everywhere.
 */
export type PublicResult = {
  product_key: string;
  brand: string;
  product_line: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number;
  thread_weight: number | null;
  material: Material;
  listings: Record<string, PublicListing>;
};

export type ShopCount = { name: string; product_count: number };

export type TextSearchInput = {
  shopping_source: string;
  product_line?: string | null;
  q?: string | null;
};

export type TextSearchResult = {
  shopping_source: string;
  product_line: string | null;
  query: string | null;
  candidates: PublicResult[];
};

export type HexSearchInput = {
  hex: string;
  tolerance?: number;
  anchorLen?: number | null;
  strictLength?: boolean;
};

export type HexMatch = PublicResult & {
  distance: number;
  length_delta: number | null;
};

export type HexSearchResult = {
  reference_hex: string;
  anchor_length_yds: number | null;
  tolerance: number;
  strict_length: boolean;
  total: number;
  matches: HexMatch[];
};

export type NeighborhoodEntry = {
  hex: string;
  distance_from_reference: number;
};

export type NeighborhoodResult = {
  reference_hex: string;
  tolerance: number;
  /** Two hexes stepping outward in one direction; each is at least 2*tol
   *  away from both the reference and the previous step, so their hex
   *  searches don't overlap with each other. */
  left: NeighborhoodEntry[];
  /** Two more hexes in the opposite half-space from `left` (negative dot
   *  product with the reference → left[0] direction vector). */
  right: NeighborhoodEntry[];
};

export class InvalidHexError extends Error {
  constructor(hex: string) {
    super(`Invalid hex: ${hex}`);
    this.name = "InvalidHexError";
  }
}

let feedCache: FeedCache | null = null;

/**
 * Force the next loadFeeds() to re-fetch from R2 instead of serving the
 * 10-minute cached copy. Called by the refresh worker after a successful
 * compile-and-upload so the runtime sees new data immediately, not after
 * the next cache-window expiry.
 */
export function invalidateFeedCache(): void {
  feedCache = null;
}

export async function loadFeeds(): Promise<FeedCache> {
  const now = Date.now();
  if (feedCache && now - feedCache.loadedAt < CACHE_TTL_MS) return feedCache;

  const [productsBytes, listingsBytes] = await Promise.all([
    downloadFromR2("supplies/products/current.json"),
    downloadFromR2("supplies/listings/current.json"),
  ]);
  if (!productsBytes || !listingsBytes) {
    throw new Error(
      "supplies feeds not available in R2 — run the refresh job first",
    );
  }

  const productsFeed = JSON.parse(
    new TextDecoder().decode(productsBytes),
  ) as ProductsFeed;
  const listingsFeed = JSON.parse(
    new TextDecoder().decode(listingsBytes),
  ) as ListingsFeed;
  const listingRows: Listing[] = Array.isArray(listingsFeed.items)
    ? listingsFeed.items
    : [];

  const listingsByProduct = new Map<string, Map<string, Listing>>();
  for (const row of listingRows) {
    let inner = listingsByProduct.get(row.product_key);
    if (!inner) {
      inner = new Map();
      listingsByProduct.set(row.product_key, inner);
    }
    inner.set(row.shopping_source, row);
  }

  feedCache = {
    loadedAt: now,
    products: productsFeed.items ?? {},
    listingsByProduct,
  };
  return feedCache;
}

/**
 * Collapse a string to alphanumeric-only lowercase so equivalent text with
 * different whitespace/punctuation matches. "Off-White", "off white", and
 * "OFFWHITE" all become "offwhite".
 */
export function toAlnum(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export function rgbDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function toPublicResult(
  product: Product,
  listingsByProduct: Map<string, Map<string, Listing>>,
): PublicResult {
  const listings: Record<string, PublicListing> = {};
  const inner = listingsByProduct.get(product.product_key);
  if (inner) {
    for (const [shop, listing] of inner.entries()) {
      listings[shop] = {
        price: listing.price,
        cost: listing.cost,
        qty: listing.qty,
        url: listing.url,
      };
    }
  }
  return {
    product_key: product.product_key,
    brand: product.brand,
    product_line: product.product_line,
    color_number: product.color_number,
    color_name: product.color_name,
    hex: product.hex,
    length_yds: product.length_yds,
    thread_weight: product.thread_weight,
    material: product.material,
    listings,
  };
}

/** Mode 1 — enumerate every shopping_source with its product count. */
export async function listShops(): Promise<{ shops: ShopCount[] }> {
  const { listingsByProduct } = await loadFeeds();
  const counts = new Map<string, number>();
  for (const inner of listingsByProduct.values()) {
    for (const shop of inner.keys()) {
      counts.set(shop, (counts.get(shop) ?? 0) + 1);
    }
  }
  const shops = [...counts.entries()]
    .map(([name, product_count]) => ({ name, product_count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { shops };
}

/**
 * Mode 2 — text search within a shop. Filters to products that have a
 * listing on the chosen `shopping_source`. Optional `product_line` further
 * narrows; `q` matches alphanumerically against color name and color number.
 */
export async function searchInShop(
  input: TextSearchInput,
): Promise<TextSearchResult> {
  const { products, listingsByProduct } = await loadFeeds();
  const shoppingSource = input.shopping_source;
  const productLine = input.product_line ?? null;
  const q = (input.q ?? "").trim().toLowerCase();
  const qNorm = toAlnum(q);

  const candidates: PublicResult[] = [];
  for (const product of Object.values(products)) {
    const listings = listingsByProduct.get(product.product_key);
    if (!listings || !listings.has(shoppingSource)) continue;
    if (productLine && product.product_line !== productLine) continue;
    if (qNorm) {
      const nameHit = toAlnum(product.color_name).includes(qNorm);
      const numHit = toAlnum(product.color_number).includes(qNorm);
      if (!nameHit && !numHit) continue;
    }
    candidates.push(toPublicResult(product, listingsByProduct));
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  // Exact color-number matches float to the top; ties broken by color_number
  // natural ordering, then length.
  candidates.sort((a, b) => {
    if (qNorm) {
      const aExact = toAlnum(a.color_number) === qNorm ? 0 : 1;
      const bExact = toAlnum(b.color_number) === qNorm ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
    }
    const cn = a.color_number.localeCompare(b.color_number, "en", {
      numeric: true,
    });
    if (cn !== 0) return cn;
    return a.length_yds - b.length_yds;
  });

  return {
    shopping_source: shoppingSource,
    product_line: productLine || null,
    query: q || null,
    candidates,
  };
}

/**
 * Mode 3 — hex-distance match. Cross-brand neighbors with the same color
 * (and, when an anchor length is supplied, the same spool size).
 * Throws `InvalidHexError` on a malformed hex string.
 */
export async function searchByHex(
  input: HexSearchInput,
): Promise<HexSearchResult> {
  const target = hexToRgb(input.hex);
  if (!target) throw new InvalidHexError(input.hex);

  const tol =
    input.tolerance !== undefined && !Number.isNaN(input.tolerance)
      ? Math.max(0, input.tolerance)
      : DEFAULT_HEX_TOLERANCE;
  const anchorLen = input.anchorLen ?? null;
  const strictLength = input.strictLength === true;

  const { products, listingsByProduct } = await loadFeeds();

  const matches: Array<{
    result: PublicResult;
    distance: number;
    lengthDelta: number | null;
  }> = [];
  for (const product of Object.values(products)) {
    if (!product.hex) continue;
    const rgb = hexToRgb(product.hex);
    if (!rgb) continue;
    const d = rgbDistance(target, rgb);
    if (d > tol) continue;

    const lengthDelta =
      anchorLen !== null ? Math.abs(product.length_yds - anchorLen) : null;
    if (
      strictLength &&
      anchorLen !== null &&
      product.length_yds !== anchorLen
    ) {
      continue;
    }

    matches.push({
      result: toPublicResult(product, listingsByProduct),
      distance: d,
      lengthDelta,
    });
  }
  matches.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.lengthDelta !== null && b.lengthDelta !== null) {
      return a.lengthDelta - b.lengthDelta;
    }
    return 0;
  });

  return {
    reference_hex: input.hex.startsWith("#") ? input.hex : `#${input.hex}`,
    anchor_length_yds: anchorLen,
    tolerance: tol,
    strict_length: strictLength,
    total: matches.length,
    matches: matches.slice(0, MAX_HEX_MATCHES).map((m) => ({
      ...m.result,
      distance: Number(m.distance.toFixed(2)),
      length_delta:
        m.lengthDelta !== null ? Number(m.lengthDelta.toFixed(0)) : null,
    })),
  };
}

/**
 * Pick 4 real feed hexes — 2 outward from the reference in one "direction"
 * and 2 in the opposite half-space — such that each pair of neighbors is
 * at least 2 * tolerance apart. That guarantees the hex search centered on
 * any neighbor shares no matches with the reference search or with the
 * adjacent step. Used to surface "explore nearby" swatches on the
 * embroidery-supplies page.
 */
export async function findNeighborhood(input: {
  hex: string;
  tolerance?: number;
}): Promise<NeighborhoodResult> {
  const rgb = hexToRgb(input.hex);
  if (!rgb) throw new InvalidHexError(input.hex);

  const tol =
    input.tolerance !== undefined && !Number.isNaN(input.tolerance)
      ? Math.max(1, input.tolerance)
      : DEFAULT_HEX_TOLERANCE;
  // Two hexes' color neighborhoods (radius tol each) are disjoint iff
  // their centers are more than 2 * tol apart.
  const minStep = 2 * tol;

  const { products } = await loadFeeds();

  type UniqueHex = {
    hex: string;
    rgb: { r: number; g: number; b: number };
    distFromR: number;
  };
  const seen = new Set<string>();
  const uniq: UniqueHex[] = [];
  for (const product of Object.values(products)) {
    if (!product.hex) continue;
    const lower = product.hex.toLowerCase();
    if (seen.has(lower)) continue;
    const parsed = hexToRgb(product.hex);
    if (!parsed) continue;
    seen.add(lower);
    uniq.push({
      hex: lower,
      rgb: parsed,
      distFromR: rgbDistance(rgb, parsed),
    });
  }
  uniq.sort((a, b) => a.distFromR - b.distFromR);

  /** left[0]: closest feed hex to R with distance > minStep. */
  const left1 = uniq.find((u) => u.distFromR > minStep) ?? null;

  /** left[1]: nearest hex to left1 (still stepping outward from R) where
   *  distance-from-left1 > minStep. */
  let left2: UniqueHex | null = null;
  if (left1) {
    let bestStep = Infinity;
    for (const u of uniq) {
      if (u.hex === left1.hex) continue;
      if (u.distFromR < left1.distFromR) continue;
      const d = rgbDistance(left1.rgb, u.rgb);
      if (d <= minStep) continue;
      if (d < bestStep) {
        bestStep = d;
        left2 = u;
      }
    }
  }

  /** Right side is the opposite half-space from left1's direction vector
   *  (dot product < 0). */
  let right1: UniqueHex | null = null;
  if (left1) {
    const vx = left1.rgb.r - rgb.r;
    const vy = left1.rgb.g - rgb.g;
    const vz = left1.rgb.b - rgb.b;
    for (const u of uniq) {
      if (u.distFromR <= minStep) continue;
      const dot =
        (u.rgb.r - rgb.r) * vx +
        (u.rgb.g - rgb.g) * vy +
        (u.rgb.b - rgb.b) * vz;
      if (dot >= 0) continue;
      right1 = u;
      break; // uniq is sorted by distFromR ascending
    }
  }

  let right2: UniqueHex | null = null;
  if (right1 && left1) {
    const vx = left1.rgb.r - rgb.r;
    const vy = left1.rgb.g - rgb.g;
    const vz = left1.rgb.b - rgb.b;
    let bestStep = Infinity;
    for (const u of uniq) {
      if (u.hex === right1.hex) continue;
      if (u.distFromR < right1.distFromR) continue;
      const dot =
        (u.rgb.r - rgb.r) * vx +
        (u.rgb.g - rgb.g) * vy +
        (u.rgb.b - rgb.b) * vz;
      if (dot >= 0) continue;
      const d = rgbDistance(right1.rgb, u.rgb);
      if (d <= minStep) continue;
      if (d < bestStep) {
        bestStep = d;
        right2 = u;
      }
    }
  }

  function toEntry(u: UniqueHex | null): NeighborhoodEntry | null {
    if (!u) return null;
    return {
      hex: u.hex.startsWith("#") ? u.hex : `#${u.hex}`,
      distance_from_reference: Number(u.distFromR.toFixed(2)),
    };
  }

  return {
    reference_hex: input.hex.startsWith("#") ? input.hex : `#${input.hex}`,
    tolerance: tol,
    left: [toEntry(left1), toEntry(left2)].filter(
      (e): e is NeighborhoodEntry => e !== null,
    ),
    right: [toEntry(right1), toEntry(right2)].filter(
      (e): e is NeighborhoodEntry => e !== null,
    ),
  };
}

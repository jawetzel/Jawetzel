/**
 * Pure search/load helpers for the embroidery-supplies feed. Shared by the
 * HTTP search route (`/api/tools/embroidery-supplies/search`) and the AI
 * assistant's `search_supplies` tool. Auth lives in the route; this module
 * is unauthenticated on purpose — callers that need to gate access gate it
 * themselves.
 *
 * Feeds are loaded from R2 once and cached at module scope for 10 minutes.
 * A refresh job rewrites `supplies/details/current.json` and
 * `supplies/pricing/current.json`; the next cache miss picks them up.
 */

import { downloadFromR2 } from "@/lib/r2";

export const CACHE_TTL_MS = 10 * 60 * 1000;
// Tight by default — image-sampled hexes have some noise, but 5 RGB covers
// that without pulling in neighboring color families. Callers can loosen
// via `tolerance` when they want a wider sweep.
export const DEFAULT_HEX_TOLERANCE = 5;
export const MAX_CANDIDATES = 100;
export const MAX_HEX_MATCHES = 200;

export type VendorDetail = Record<string, unknown> & {
  url_key?: string;
  url_suffix?: string;
  online_store_url?: string;
  path?: string;
  item_seo_link?: string;
};

export type DetailEntry = {
  shopping_source: string;
  manufacturer: string | null;
  brand: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  vendors: Record<string, VendorDetail>;
};

export type PricingRow = {
  shopping_source: string;
  manufacturer: string | null;
  brand: string;
  color_number: string;
  hex: string | null;
  length_yds: number | null;
  vendor: string;
  price: number | null;
  cost: number | null;
  qty: number | null;
};

export type FeedCache = {
  loadedAt: number;
  details: Record<string, DetailEntry>;
  /** Map<detailKey, Map<vendor, row>> — built once at cache-load from the
   *  flat pricing array for O(1) per-vendor lookup in the join path. */
  pricingByKey: Map<string, Map<string, PricingRow>>;
};

export type PublicResult = {
  key: string;
  shopping_source: string;
  manufacturer: string | null;
  brand: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  vendors: Record<
    string,
    { price: number | null; cost: number | null; qty: number | null; url: string | null }
  >;
};

export type ShopCount = { name: string; color_count: number };

export type TextSearchInput = {
  shopping_source: string;
  brand?: string | null;
  q?: string | null;
};

export type TextSearchResult = {
  shopping_source: string;
  brand: string | null;
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

export class InvalidHexError extends Error {
  constructor(hex: string) {
    super(`Invalid hex: ${hex}`);
    this.name = "InvalidHexError";
  }
}

let feedCache: FeedCache | null = null;

export async function loadFeeds(): Promise<FeedCache> {
  const now = Date.now();
  if (feedCache && now - feedCache.loadedAt < CACHE_TTL_MS) return feedCache;

  const [detailsBytes, pricingBytes] = await Promise.all([
    downloadFromR2("supplies/details/current.json"),
    downloadFromR2("supplies/pricing/current.json"),
  ]);
  if (!detailsBytes || !pricingBytes) {
    throw new Error(
      "supplies feeds not available in R2 — run the refresh job first",
    );
  }

  const detailsFeed = JSON.parse(new TextDecoder().decode(detailsBytes));
  const pricingFeed = JSON.parse(new TextDecoder().decode(pricingBytes));
  const pricingRows: PricingRow[] = Array.isArray(pricingFeed.items)
    ? pricingFeed.items
    : [];

  const pricingByKey = new Map<string, Map<string, PricingRow>>();
  for (const row of pricingRows) {
    const key = `${row.brand}|${row.color_number}`;
    let inner = pricingByKey.get(key);
    if (!inner) {
      inner = new Map();
      pricingByKey.set(key, inner);
    }
    inner.set(row.vendor, row);
  }

  feedCache = {
    loadedAt: now,
    details: detailsFeed.items ?? {},
    pricingByKey,
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

export function vendorUrlFor(
  vendor: string,
  detail: VendorDetail,
): string | null {
  switch (vendor) {
    case "habanddash":
      return detail.url_key
        ? `https://www.habanddash.com/${detail.url_key}${detail.url_suffix ?? ""}`
        : null;
    case "allstitch":
      return (detail.online_store_url as string) ?? null;
    case "sulky":
      return detail.path ? `https://sulky.com${detail.path}` : null;
    case "gunnold":
      // Gunold's canonical product URL is `/item/<slug>/` — works across
      // every product line (Poly, Cotty, Filaine, etc.). We originally
      // used `/mx/polyester-embroidery-thread-40/<slug>/` but that path
      // was the Poly 40 landing page we scraped for the access token,
      // not a universal base.
      return detail.item_seo_link
        ? `https://www.gunold.com/item/${detail.item_seo_link}/`
        : null;
    case "coldesi":
      // Coldesi curated shape stores the full URL we computed during extract.
      return (detail.online_store_url as string) ?? null;
    case "threadart":
      return (detail.online_store_url as string) ?? null;
    default:
      return null;
  }
}

export function toPublicResult(
  key: string,
  detail: DetailEntry,
  pricingByKey: Map<string, Map<string, PricingRow>>,
): PublicResult {
  const vendorPricing = pricingByKey.get(key);
  const vendors: PublicResult["vendors"] = {};
  for (const [vName, vDetail] of Object.entries(detail.vendors)) {
    const row = vendorPricing?.get(vName);
    vendors[vName] = {
      price: row?.price ?? null,
      cost: row?.cost ?? null,
      qty: row?.qty ?? null,
      url: vendorUrlFor(vName, vDetail),
    };
  }
  return {
    key,
    shopping_source: detail.shopping_source,
    manufacturer: detail.manufacturer,
    brand: detail.brand,
    color_number: detail.color_number,
    color_name: detail.color_name,
    hex: detail.hex,
    length_yds: detail.length_yds,
    thread_weight: detail.thread_weight,
    vendors,
  };
}

/**
 * Drop entries without a yardage — spool size is required for meaningful
 * cross-vendor comparison. Rows without a *price* are kept: the UI can
 * still link through to the vendor's product page (useful for auth-gated
 * vendors like Hab+Dash where pricing requires a dealer login).
 */
export function hasLength(result: PublicResult): boolean {
  return result.length_yds !== null;
}

/** Mode 1 — enumerate every shop (`shopping_source`) with its color count. */
export async function listShops(): Promise<{ shops: ShopCount[] }> {
  const { details } = await loadFeeds();
  const counts = new Map<string, number>();
  for (const entry of Object.values(details)) {
    counts.set(
      entry.shopping_source,
      (counts.get(entry.shopping_source) ?? 0) + 1,
    );
  }
  const shops = [...counts.entries()]
    .map(([name, color_count]) => ({ name, color_count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { shops };
}

/**
 * Mode 2 — text search within a shop (optionally narrowed to a specific
 * product line via `brand`). Query and each field are collapsed to
 * alphanumeric-lowercase before comparison so "off-white" ≈ "off white"
 * ≈ "OFFWHITE" all resolve to the same thing.
 */
export async function searchInShop(
  input: TextSearchInput,
): Promise<TextSearchResult> {
  const { details, pricingByKey } = await loadFeeds();
  const shoppingSource = input.shopping_source;
  const brand = input.brand ?? null;
  const q = (input.q ?? "").trim().toLowerCase();
  const qNorm = toAlnum(q);

  const candidates: PublicResult[] = [];
  for (const [key, entry] of Object.entries(details)) {
    if (entry.shopping_source !== shoppingSource) continue;
    if (brand && entry.brand !== brand) continue;
    if (qNorm) {
      const nameHit = toAlnum(entry.color_name).includes(qNorm);
      const numHit = toAlnum(entry.color_number).includes(qNorm);
      if (!nameHit && !numHit) continue;
    }
    const result = toPublicResult(key, entry, pricingByKey);
    if (!hasLength(result)) continue;
    candidates.push(result);
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
    return (a.length_yds ?? 0) - (b.length_yds ?? 0);
  });

  return {
    shopping_source: shoppingSource,
    brand: brand || null,
    query: q || null,
    candidates,
  };
}

/**
 * Mode 3 — hex-distance match. Cross-manufacturer neighbors with the same
 * color (and, when an anchor length is supplied, the same spool size).
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

  const { details, pricingByKey } = await loadFeeds();

  const matches: Array<{
    result: PublicResult;
    distance: number;
    lengthDelta: number | null;
  }> = [];
  for (const [key, entry] of Object.entries(details)) {
    if (!entry.hex) continue;
    const rgb = hexToRgb(entry.hex);
    if (!rgb) continue;
    const d = rgbDistance(target, rgb);
    if (d > tol) continue;

    const lengthDelta =
      anchorLen !== null && entry.length_yds !== null
        ? Math.abs(entry.length_yds - anchorLen)
        : null;
    if (
      strictLength &&
      anchorLen !== null &&
      entry.length_yds !== null &&
      entry.length_yds !== anchorLen
    ) {
      continue;
    }

    const result = toPublicResult(key, entry, pricingByKey);
    if (!hasLength(result)) continue;
    matches.push({ result, distance: d, lengthDelta });
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

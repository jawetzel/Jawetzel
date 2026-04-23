/**
 * Search endpoint for the embroidery-supplies tool. Three modes, one route:
 *
 *   GET /search                      → { brands: [{ name, color_count }, ...] }
 *   GET /search?brand=X[&q=Y]        → { candidates: [<thread>, ...] }
 *                                      Text match on color_name or color_number
 *                                      within the chosen brand.
 *   GET /search?hex=#rrggbb[&tol=N]  → { reference_hex, tolerance,
 *                                        matches: [<thread> + distance, ...] }
 *                                      All records across every brand whose
 *                                      hex is within `tol` (Euclidean RGB
 *                                      distance) of the reference.
 *
 * Data is loaded once from R2 (`supplies/details/current.json` +
 * `supplies/pricing/current.json`) and kept in module-level memory for 10
 * minutes per the user request — subsequent requests in that window are served
 * entirely from cache. `/refresh` writes new versions of the feeds, which will
 * be picked up on the next cache miss.
 *
 * Auth: any authenticated principal (session cookie, per-user API key, or the
 * shared EMBROIDERY_API_KEY) — we don't restrict by role here, just gate the
 * feature behind sign-in.
 */

import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { downloadFromR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000;
// Tight by default — image-sampled hexes have some noise, but 5 RGB covers
// that without pulling in neighboring color families. Callers can loosen
// via `tol=` when they want a wider sweep.
const DEFAULT_HEX_TOLERANCE = 5;
const MAX_CANDIDATES = 100;
const MAX_HEX_MATCHES = 200;

type VendorDetail = Record<string, unknown> & {
  // vendor-specific fields we care about for URL composition
  url_key?: string;
  url_suffix?: string;
  online_store_url?: string;
  path?: string;
  item_seo_link?: string;
};

type DetailEntry = {
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

type PricingRow = {
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

type FeedCache = {
  loadedAt: number;
  details: Record<string, DetailEntry>;
  /** Map<detailKey, Map<vendor, row>> — built once at cache-load from the
   *  flat pricing array for O(1) per-vendor lookup in the join path. */
  pricingByKey: Map<string, Map<string, PricingRow>>;
};

let feedCache: FeedCache | null = null;

async function getFeeds(): Promise<FeedCache> {
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
function toAlnum(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgbDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function vendorUrlFor(vendor: string, detail: VendorDetail): string | null {
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

type PublicResult = {
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

function toPublicResult(
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
function hasLength(result: PublicResult): boolean {
  return result.length_yds !== null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "EMBROIDERY_API_KEY");
  if (auth instanceof Response) return auth;

  let feeds: FeedCache;
  try {
    feeds = await getFeeds();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Feed load failed" },
      { status: 503 },
    );
  }

  const { details, pricingByKey } = feeds;
  const { searchParams } = new URL(request.url);
  const brand = searchParams.get("brand");
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const hexParam = searchParams.get("hex");
  const tolParam = searchParams.get("tol");

  const shoppingSource = searchParams.get("shopping_source");
  const anchorLenParam = searchParams.get("length_yds");
  const anchorLen =
    anchorLenParam && !Number.isNaN(parseFloat(anchorLenParam))
      ? parseFloat(anchorLenParam)
      : null;
  const strictLenParam = searchParams.get("strict_length");
  // Default off — the match view groups results by length bucket so multiple
  // spool sizes are useful to see at once (250 yd spool vs. 5,500 yd jumbo
  // cone at the same color). Callers can opt in with `strict_length=1` to
  // restrict to the anchor's length only.
  const strictLength = strictLenParam === "1";

  // Mode 3 — hex-distance match. Cross-manufacturer neighbors with the same
  // color (and, when an anchor length is supplied, the same spool size).
  if (hexParam) {
    const target = hexToRgb(hexParam);
    if (!target) {
      return Response.json(
        { error: `Invalid hex: ${hexParam}` },
        { status: 400 },
      );
    }
    const tol =
      tolParam && !Number.isNaN(parseFloat(tolParam))
        ? Math.max(0, parseFloat(tolParam))
        : DEFAULT_HEX_TOLERANCE;

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

    return Response.json({
      reference_hex: hexParam.startsWith("#") ? hexParam : `#${hexParam}`,
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
    });
  }

  // Mode 1 — shops list (no shopping_source param, no hex param).
  if (!shoppingSource) {
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
    return Response.json({ shops });
  }

  // Mode 2 — text search within a shop (optionally narrowed to a specific
  // product line via `brand=`). Query and each field are collapsed to
  // alphanumeric-lowercase before comparison so "off-white" ≈ "off white"
  // ≈ "OFFWHITE" all resolve to the same thing.
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

  return Response.json({
    shopping_source: shoppingSource,
    brand: brand || null,
    query: q || null,
    candidates,
  });
}

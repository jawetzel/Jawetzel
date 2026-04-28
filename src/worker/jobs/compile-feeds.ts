/**
 * Cross-vendor feed compiler.
 *
 * Runs after `Promise.allSettled` in the refresh orchestrator. Takes the
 * in-memory pull results (no R2 re-read) and produces two derived feeds:
 *
 *   - `supplies/products/current.json` — one entry per real-world thread
 *     (brand × product_line × color_number × length_yds). Holds canonical
 *     identity + meta. No per-shop data.
 *
 *   - `supplies/listings/current.json` — flat array, one row per
 *     (product × shopping_source). Holds buy-side data: price, cost, qty,
 *     and the click-through URL (baked at compile time).
 *
 * Vocabulary:
 *   - shopping_source = retailer / store you click to buy from
 *     ("AllStitch", "Hab+Dash", "ColDesi", ...)
 *   - brand = the company that made the thread
 *     ("Madeira", "Fil-Tec", "Sulky", "Gunold", "Isacord", ...)
 *   - product_line = the line within that brand
 *     ("Polyneon 40", "Glide 40wt", "Rayon 40", "Poly 40 Wt. 5,500", ...)
 *
 * `vendor` is the worker-internal scraper key (slug form: "gunnold", "sulky",
 * "habanddash", ...). It maps 1:1 to `shopping_source` via SHOPPING_SOURCE
 * and never appears in runtime types or feed output.
 *
 * Length policy: `length_yds` is part of `product_key`, so any extracted
 * item without a yardage is counted into `unmatchedByVendor` and dropped
 * from both feeds. Same color in two spool sizes → two products → its
 * own listings.
 *
 * Hex column is looked up per (vendor, product_line, color_number) against
 * the bundled Ink/Stitch GPL palettes via a heuristic vendor → palette
 * mapping. Misses return null and can be fixed by adjusting `paletteKeyFor()`
 * or adding more palette files.
 *
 * Neither feed has a dated archive — they're derived from per-vendor archives
 * which are the source of truth for history. Rerunning the compile against
 * any past date's vendor archives would regenerate these files.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GunnoldItem, GunnoldPullResult } from "./sources/gunnold-pull";
import type { SulkyItem, SulkyPullResult } from "./sources/sulky-pull";
import type { AllStitchItem, AllStitchPullResult } from "./sources/allstitch-pull";
import type {
  HabanddashItem,
  HabanddashPullResult,
} from "./sources/habanddash-pull";
import type { ColdesiItem, ColdesiPullResult } from "./sources/coldesi-pull";
import type {
  ThreadartItem,
  ThreadartPullResult,
} from "./sources/threadart-pull";
import type {
  OhmycraftyItem,
  OhmycraftyPullResult,
} from "./sources/ohmycrafty-pull";

// ─── Types ────────────────────────────────────────────────────────────────

/** Every wired vendor — keep in sync with orchestrator VENDORS list. */
export const VENDOR_NAMES = [
  "gunnold",
  "sulky",
  "allstitch",
  "habanddash",
  "coldesi",
  "threadart",
  "ohmycrafty",
] as const;
export type VendorName = (typeof VENDOR_NAMES)[number];

export type Material =
  | "polyester"
  | "rayon"
  | "cotton"
  | "metallic"
  | "wool"          // includes wool/acrylic blends like Madeira Burmilana
  | "monofilament"  // clear nylon
  | "silk"
  | "unknown";

/**
 * One canonical entity per real-world thread color × spool size. Identity
 * is shared across every retailer that carries it; per-shop data lives in
 * `Listing`.
 */
export type Product = {
  product_key: string;            // <brand>|<product_line>|<color_number>|<length_yds>
  brand: string;                  // manufacturer
  product_line: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number;             // non-null (in the key); items without one are dropped at compile
  thread_weight: number | null;
  material: Material;
};

/**
 * One row per (product × shopping_source). Carries the buy-side data
 * including the click-through URL — baked at compile time so the runtime
 * never reconstructs vendor-specific URL recipes. `url` may be null when
 * the vendor doesn't expose a public product page.
 */
export type Listing = {
  product_key: string;            // FK to Product
  shopping_source: string;        // "AllStitch", "Hab+Dash", ...
  url: string | null;
  price: number | null;
  cost: number | null;
  qty: number | null;
};

export type ProductsFeed = {
  source: "supplies-products";
  fetchedAt: string;
  keyCount: number;
  vendorsIncluded: VendorName[];
  unmatchedByVendor: Partial<Record<VendorName, number>>;
  items: Record<string, Product>;
};

export type ListingsFeed = {
  source: "supplies-listings";
  fetchedAt: string;
  keyCount: number;                // number of distinct products with at least one listing
  vendorsIncluded: VendorName[];
  items: Listing[];
};

export type CompileInput = Partial<{
  gunnold: GunnoldPullResult;
  sulky: SulkyPullResult;
  allstitch: AllStitchPullResult;
  habanddash: HabanddashPullResult;
  coldesi: ColdesiPullResult;
  threadart: ThreadartPullResult;
  ohmycrafty: OhmycraftyPullResult;
}>;

export type CompileResult = {
  products: ProductsFeed;
  listings: ListingsFeed;
  listingsCsv: string;
};

/**
 * Per-item extractor output. `null` for items that can't be cleanly mapped
 * onto a (brand, product_line, color, length) — extractor bails, caller
 * increments unmatched. `length_yds` may also be null inside an Extracted;
 * the compile pass drops those into unmatched too, since length is in the
 * product key.
 */
type Extracted = {
  brand: string;
  product_line: string;
  color_number: string;
  color_name: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  material: Material;
  detail: Record<string, unknown>;  // raw vendor blob, used only for URL building
  price: number | null;
  cost: number | null;
  qty: number | null;
} | null;

// ─── Helpers ──────────────────────────────────────────────────────────────

function normString(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normColor(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = String(s).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Drop leading zeros from a color number for palette-friendly lookups.
 * Only applies when the string is purely numeric — alphanumeric codes
 * (e.g. AllStitch "N1977") are left unchanged. Empty / null-like inputs
 * round-trip unchanged.
 */
function stripLeadingZeros(s: string | null): string | null {
  if (s === null) return null;
  if (!/^\d+$/.test(s)) return s;
  const stripped = s.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : "0";
}

function buildProductKey(
  brand: string,
  productLine: string,
  colorNumber: string,
  lengthYds: number,
): string {
  return `${brand}|${productLine}|${colorNumber}|${lengthYds}`;
}

/**
 * Map each scraper's `VendorName` to its public-facing shopping-source
 * label — the retailer / store name. Single source of truth; every
 * downstream piece of code uses this label, never the raw VendorName slug.
 */
const SHOPPING_SOURCE: Record<VendorName, string> = {
  gunnold: "Gunold",
  sulky: "Sulky",
  allstitch: "AllStitch",
  habanddash: "Hab+Dash",
  coldesi: "ColDesi",
  threadart: "ThreadArt",
  ohmycrafty: "OhMyCrafty",
};

/**
 * Infer the thread's brand (manufacturer) from (vendor, raw product_line).
 * Maker-direct shops (Sulky → Sulky, Gunold → Gunold, ThreadArt → ThreadArt)
 * always know their brand. Multi-brand resellers (AllStitch, Hab+Dash, ColDesi)
 * pattern-match on the product_line string.
 *
 * Returns null when the line doesn't fit a known pattern; the extractor
 * decides whether to bail (skip the item).
 */
function brandFor(
  vendor: VendorName,
  rawProductLine: string,
): string | null {
  const b = rawProductLine.toLowerCase();
  switch (vendor) {
    case "gunnold":
      return "Gunold";
    case "sulky":
      return "Sulky";
    case "habanddash":
      // Hab+Dash is Fil-Tec's primary retail channel; Glide + Magna-Glide
      // are the Fil-Tec lines. Non-Fil-Tec items (kits, accessories) → null.
      if (/glide|magna|cairo-quilt|premo-soft/.test(b)) return "Fil-Tec";
      return null;
    case "allstitch":
      // AllStitch resells Madeira primarily, with some Fil-Tec / Gunold
      // crossover.
      if (/glide|magna/.test(b)) return "Fil-Tec";
      if (/gunold|solvy/.test(b)) return "Gunold";
      if (
        /polyneon|rayon|aerofil|aerolock|aeroflock|aeroquilt|cotona|sensa|fire fighter|metallic|burmilana|matt|supertwist|bobbinfil|monofil/.test(
          b,
        )
      )
        return "Madeira";
      return null;
    case "coldesi":
      // ColDesi's threads: Isacord, Endura, Royal — single-line companies
      // where the brand name and product line share the string.
      if (/isacord/.test(b)) return "Isacord";
      if (/endura/.test(b)) return "Endura";
      if (/royal/.test(b)) return "Royal";
      return null;
    case "threadart":
      return "ThreadArt";
    case "ohmycrafty":
      // OhMyCrafty's thread catalog is exclusively Gunold-branded
      // (pre-filtered at the API via brand_id=1597 in the puller).
      return "Gunold";
  }
}

/**
 * Infer the thread's material (fiber type) from (vendor, raw product_line).
 * Same context-plus-pattern shape as brandFor. Falls through to "unknown"
 * rather than null so material is always populated on a Product.
 */
function materialFor(
  vendor: VendorName,
  rawProductLine: string,
): Material {
  const b = rawProductLine.toLowerCase();
  switch (vendor) {
    case "gunnold":
      // Gunnold's catalog is all Poly lines (Poly 40/60, PolyFire).
      return "polyester";
    case "sulky":
      if (/rayon/.test(b)) return "rayon";
      if (/cotton/.test(b)) return "cotton";
      if (/poly|polylite|polydeco|filaine/.test(b)) return "polyester";
      return "unknown";
    case "habanddash":
      if (/glide|magna/.test(b)) return "polyester";
      return "unknown";
    case "allstitch":
      if (/rayon/.test(b)) return "rayon";
      if (/cotona/.test(b)) return "cotton";
      if (/burmilana/.test(b)) return "wool";
      if (/metallic|supertwist/.test(b)) return "metallic";
      if (/monofil/.test(b)) return "monofilament";
      if (
        /polyneon|aerofil|aerolock|aeroflock|aeroquilt|sensa|matt|fire fighter|bobbinfil/.test(
          b,
        )
      )
        return "polyester";
      return "unknown";
    case "coldesi":
      // Isacord / Endura / Royal are all 40wt polyester per ColDesi's catalog.
      return "polyester";
    case "threadart":
      // Pass the Fiber tag (or product_line as a fallback) through here.
      if (/polyester/.test(b)) return "polyester";
      if (/rayon/.test(b)) return "rayon";
      if (/cotton/.test(b)) return "cotton";
      if (/metallic/.test(b)) return "metallic";
      return "unknown";
    case "ohmycrafty":
      // OhMyCrafty's Gunold catalog is mostly Poly* lines (polyester) plus
      // Cotty (cotton), Filaine (wool), Mety (metallic), Glowy/Glitter
      // (specialty). Same shape as gunnold's classifier.
      if (/cotty|cotton/.test(b)) return "cotton";
      if (/filaine|wool/.test(b)) return "wool";
      if (/mety|metallic|glitter|sparkle|flash/.test(b)) return "metallic";
      if (/poly/.test(b)) return "polyester";
      return "unknown";
  }
}

/**
 * Build the click-through URL for a listing from the vendor's raw detail
 * blob. Lives at compile time — the runtime never sees vendor-specific
 * URL recipes (url_key, online_store_url, path, item_seo_link) because
 * the URL is baked onto the Listing.
 */
function urlForListing(
  vendor: VendorName,
  detail: Record<string, unknown>,
): string | null {
  switch (vendor) {
    case "habanddash": {
      const urlKey = detail.url_key as string | undefined;
      const urlSuffix = (detail.url_suffix as string | undefined) ?? "";
      return urlKey ? `https://www.habanddash.com/${urlKey}${urlSuffix}` : null;
    }
    case "allstitch":
      return (detail.online_store_url as string) ?? null;
    case "sulky": {
      const path = detail.path as string | undefined;
      return path ? `https://sulky.com${path}` : null;
    }
    case "gunnold": {
      // Gunold's canonical product URL is `/item/<slug>/` — works across
      // every product line. We originally used the Poly 40 landing path
      // we scraped for the access token; that was a curated Poly-only
      // base, not universal.
      const slug = detail.item_seo_link as string | undefined;
      return slug ? `https://www.gunold.com/item/${slug}/` : null;
    }
    case "coldesi":
    case "threadart":
      return (detail.online_store_url as string) ?? null;
    case "ohmycrafty":
      // The puller stores the WooCommerce permalink as the click-through.
      return (detail.permalink as string) ?? null;
  }
}

/**
 * Extract a yardage integer from a free-text string like
 *   "1,000 yds", "5,500yds", "220 yd", "1100 Yards"
 * Returns null if no yardage is mentioned. Commas stripped before parsing.
 */
function parseYardsFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/([\d,]+)\s*(?:yd|yds|yard|yards)\b/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a thread weight integer from a free-text string. Thread weights are
 * usually 12, 30, 35, 40, 50, 60, 80, 100, 120, but accept any 5–200 range.
 *
 * Tries specific patterns first (`40 Wt`, `NO. 40`, `#40`), then falls back
 * to the first plausible 2-3 digit number. Returns null on no match.
 */
function parseThreadWeight(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = String(text);
  const patterns: RegExp[] = [
    /\b(\d{2,3})\s*(?:wt|weight)\b/i,
    /\bNO\.?\s*(\d{2,3})/i,
    /#\s*(\d{2,3})\b/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 5 && n <= 200) return n;
    }
  }
  const m = s.match(/\b(\d{2,3})\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 5 && n <= 200) return n;
  }
  return null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/,/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Map a vendor's raw product_line to the Ink/Stitch palette key holding the
 * authoritative hex values for that line. Substring match; expected to miss
 * — unknown mappings return null and the entry gets `hex: null` downstream.
 */
function paletteKeyFor(
  vendor: VendorName,
  rawProductLine: string,
): string | null {
  const b = rawProductLine.toLowerCase();
  switch (vendor) {
    case "gunnold":
      if (/poly/.test(b)) return "gunold-polyester";
      return null;
    case "sulky":
      if (/rayon/.test(b)) return "sulky-rayon";
      if (/cotton|poly|polylite|poly\s*deco|filaine/.test(b))
        return "sulky-polyester";
      return null;
    case "allstitch":
      if (/polyneon/.test(b)) return "madeira-polyneon";
      if (/rayon/.test(b)) return "madeira-rayon";
      if (/burmilana/.test(b)) return "madeira-burmilana";
      if (/matt/.test(b)) return "madeira-matt";
      return null;
    case "habanddash":
      if (/glide/.test(b)) return "fil-tec-glide";
      return null;
    case "coldesi":
      if (/isacord/.test(b)) return "isacord-polyester";
      if (/royal/.test(b)) return "royal-polyester";
      return null;
    case "threadart":
      return "threadart";
    case "ohmycrafty":
      // OhMyCrafty resells Gunold; same Ink/Stitch palette as gunnold.
      if (/poly/.test(b)) return "gunold-polyester";
      return null;
  }
}

type ThreadColorMap = {
  generated_at: string;
  stats: Record<string, unknown>;
  entries: Record<string, { hex: string; name?: string; source: string }>;
};

/**
 * Master thread-color map — checked-in JSON file built offline by
 * `scripts/build-thread-color-map.mjs` from Ink/Stitch palettes and the
 * Gunold crossmatch PDFs. Single source of truth for hex at runtime.
 */
let threadColorMap: ThreadColorMap["entries"] | null = null;

function getThreadColorMap(): ThreadColorMap["entries"] {
  if (threadColorMap) return threadColorMap;
  const filePath = join(
    process.cwd(),
    "src",
    "data",
    "thread-color-map.json",
  );
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ThreadColorMap;
    threadColorMap = parsed.entries ?? {};
    console.log(
      `[compile-feeds] loaded thread-color-map: ${Object.keys(threadColorMap).length} entries`,
    );
  } catch (err) {
    console.error(
      `[compile-feeds] failed to load thread-color-map.json — hex column will be all null. Rebuild with: node scripts/build-thread-color-map.mjs`,
      err instanceof Error ? err.message : err,
    );
    threadColorMap = {};
  }
  return threadColorMap;
}

/**
 * Look up palette hex AND palette color name for a (vendor, product_line,
 * color_number). Vendors that don't expose `color_name` (AllStitch,
 * Hab+Dash) use the palette name as a fallback.
 *
 * Palette path wins over the raw-product_line (image-sample) path because
 * the sampler only stores hex, not names.
 */
function computePaletteLookup(
  vendor: VendorName,
  rawProductLine: string,
  colorNumber: string,
): { hex: string | null; name: string | null } {
  const map = getThreadColorMap();
  const paletteKey = paletteKeyFor(vendor, rawProductLine);
  if (paletteKey) {
    // Some Coldesi SKUs tack on a size/variant suffix letter ("0001M" for
    // the Mini variant of Isacord 0001). Palette entries are stored under
    // the bare numeric code, so try the stripped form as a fallback.
    const candidates = [
      colorNumber,
      colorNumber.replace(/[A-Z]+$/, ""),
    ].filter((c, i, arr) => c && arr.indexOf(c) === i);
    for (const cn of candidates) {
      const palEntry = map[`${paletteKey}|${cn}`];
      if (palEntry?.hex) {
        return { hex: palEntry.hex, name: palEntry.name ?? null };
      }
    }
  }
  // Fallback keyed by raw product_line. Built from non-palette sources
  // (image samples, Gunold crossmatch PDFs).
  const rawEntry = map[`${rawProductLine}|${colorNumber}`];
  return {
    hex: rawEntry?.hex ?? null,
    name: rawEntry?.name ?? null,
  };
}

// ─── Per-vendor extractors ────────────────────────────────────────────────

/**
 * Gunnold — `brand` field on the item is what we now call `product_line`.
 * Color comes from the last 5 digits of `stock_number` for palette
 * compatibility (the `color_number` field strips the line prefix).
 */
function extractGunnold(item: GunnoldItem): Extracted {
  const productLine = normString(item.brand);
  const color =
    gunnoldColorFromStockNumber(item.stock_number) ?? normColor(item.color_number);
  if (!productLine || !color) return null;

  const brand = brandFor("gunnold", productLine);
  if (!brand) return null;

  const {
    list_price,
    last_cost,
    average_cost,
    standard_cost,
    quantity_available,
    color_number,
    color_name,
    yardage,
    ...detail
  } = item;
  void average_cost;
  void standard_cost;
  void color_number;

  return {
    brand,
    product_line: productLine,
    color_number: color,
    color_name: normColor(color_name),
    length_yds: toFiniteNumber(yardage) ?? parseYardsFromText(productLine),
    thread_weight:
      parseThreadWeight(item.thread_weight) ?? parseThreadWeight(productLine),
    material: materialFor("gunnold", productLine),
    detail,
    price: typeof list_price === "number" ? list_price : null,
    cost: typeof last_cost === "number" ? last_cost : null,
    qty: typeof quantity_available === "number" ? quantity_available : null,
  };
}

function gunnoldColorFromStockNumber(sn: string | undefined): string | null {
  if (!sn) return null;
  const digits = String(sn).replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(-5);
}

/**
 * Sulky — `brand_name` is what we now call `product_line`. Storefront API
 * exposes no cost. Many items lack a color_number (digital products,
 * assortments, accessories) — those get skipped.
 */
function extractSulky(item: SulkyItem): Extracted {
  const productLine = normString(item.brand_name);
  // Sulky stores some colors with leading zeros ("0502") while Ink/Stitch's
  // palette has them plain ("502"). Normalize for both key + palette lookup.
  const color = stripLeadingZeros(normColor(item.color_number));
  if (!productLine || !color) return null;

  const brand = brandFor("sulky", productLine);
  if (!brand) return null;

  const {
    price,
    sale_price,
    retail_price,
    currency_code,
    availability_status,
    is_in_stock,
    available_to_sell,
    has_variant_inventory,
    variants,
    color_number,
    color_name,
    yardage,
    ...detail
  } = item;
  void sale_price;
  void retail_price;
  void currency_code;
  void availability_status;
  void is_in_stock;
  void has_variant_inventory;
  void variants;
  void color_number;

  return {
    brand,
    product_line: productLine,
    color_number: color,
    color_name: normColor(color_name),
    length_yds: toFiniteNumber(yardage) ?? parseYardsFromText(productLine),
    thread_weight:
      parseThreadWeight(item.thread_weight) ?? parseThreadWeight(productLine),
    material: materialFor("sulky", productLine),
    detail,
    price: typeof price === "number" ? price : null,
    cost: null,
    qty: typeof available_to_sell === "number" ? available_to_sell : null,
  };
}

/**
 * AllStitch — most items are Madeira threads resold via Shopify. Strategy:
 *   - product_line comes from the `Thread Type_<series>` tag, with weight
 *     and length parsed out of the suffix ("Polyneon 40-440 yd" splits
 *     into product_line "Polyneon 40" and length 440).
 *   - color number comes from the SKU suffix after the last dash.
 * Skip items without both signals (foam, needles, hoops, bobbins, etc.).
 */
function extractAllstitch(item: AllStitchItem): Extracted {
  const threadTypeTag = item.tags?.find((t) => t.startsWith("Thread Type_"));
  const rawTag = threadTypeTag
    ? normString(threadTypeTag.replace("Thread Type_", ""))
    : null;
  const color = extractAllstitchColorNumber(item.sku);
  if (!rawTag || !color) return null;

  // Pattern: "<line> <weight>-<yards> yd". Falls back to the raw tag if the
  // suffix doesn't match (some Thread Type tags don't follow the convention).
  let productLine = rawTag;
  let lengthFromTag: number | null = null;
  const m = rawTag.match(/^(.+?)\s+(\d+)-(\d+)\s*yd$/i);
  if (m) {
    productLine = `${m[1]} ${m[2]}`;
    lengthFromTag = parseInt(m[3], 10);
  }

  const brand = brandFor("allstitch", productLine);
  if (!brand) return null;

  const {
    price,
    currency_code,
    compare_at_price,
    unit_price,
    available_for_sale,
    currently_not_in_stock,
    quantity_available,
    total_inventory,
    ...detail
  } = item;
  void currency_code;
  void compare_at_price;
  void unit_price;
  void available_for_sale;
  void currently_not_in_stock;
  void total_inventory;

  return {
    brand,
    product_line: productLine,
    color_number: color,
    color_name: null,
    length_yds:
      lengthFromTag ??
      parseYardsFromText(item.title) ??
      parseYardsFromText(item.variant_title) ??
      parseYardsFromText(productLine),
    thread_weight:
      parseThreadWeight(productLine) ??
      parseThreadWeight(item.title) ??
      parseThreadWeight(item.product_type),
    material: materialFor("allstitch", productLine),
    detail,
    price: typeof price === "number" ? price : null,
    cost: null,
    qty: typeof quantity_available === "number" ? quantity_available : null,
  };
}

/** AllStitch SKU suffix = color number (e.g., `922-N1977` → `N1977`). */
function extractAllstitchColorNumber(sku: string | null): string | null {
  if (!sku) return null;
  const idx = sku.lastIndexOf("-");
  if (idx < 0 || idx === sku.length - 1) return null;
  return normColor(sku.slice(idx + 1));
}

/**
 * Hab+Dash — SKUs like `450.77402` encode `<series>.<color_number>`.
 * Product_line comes from the deepest category containing the series
 * marker, e.g. `Glide (NO. 40) Trilobal Polyester`. Skip items whose
 * SKU doesn't match the dotted pattern (kits, accessories).
 */
function extractHabanddash(item: HabanddashItem): Extracted {
  const color = extractHabdashColorFromSku(item.sku);
  const productLine = extractHabdashProductLineFromCategories(item.categories);
  if (!productLine || !color) return null;

  const brand = brandFor("habanddash", productLine);
  if (!brand) return null;

  const {
    regular_price,
    regular_price_currency,
    final_price,
    final_price_currency,
    discount_amount_off,
    discount_percent_off,
    special_price,
    special_to_date,
    price_tiers,
    stock_status,
    only_x_left_in_stock,
    ...detail
  } = item;
  void regular_price_currency;
  void final_price_currency;
  void discount_amount_off;
  void discount_percent_off;
  void special_price;
  void special_to_date;
  void price_tiers;
  void stock_status;

  const price =
    typeof final_price === "number"
      ? final_price
      : typeof regular_price === "number"
        ? regular_price
        : null;

  return {
    brand,
    product_line: productLine,
    color_number: color,
    color_name: null,
    length_yds:
      parseYardsFromText(item.name) ??
      parseYardsFromText(item.meta_title) ??
      null,
    thread_weight:
      parseThreadWeight(
        (item.categories ?? []).map((c) => c.name).join(" "),
      ) ??
      parseThreadWeight(item.name) ??
      parseThreadWeight(productLine),
    material: materialFor("habanddash", productLine),
    detail,
    price,
    cost: null,
    // Magento public API exposes `only_x_left_in_stock` only when stock is
    // low, plus a binary IN_STOCK/OUT_OF_STOCK flag. Full counts need a
    // dealer login. Fall back to `1` as a sentinel for "in stock, count
    // not published" so the cell surfaces availability rather than going
    // null-and-blank. Out-of-stock → null.
    qty:
      typeof only_x_left_in_stock === "number"
        ? only_x_left_in_stock
        : stock_status === "IN_STOCK"
          ? 1
          : null,
  };
}

/**
 * Coldesi carries three thread brands under one storefront. Brand and
 * color number come from the title/SKU pattern, not the Shopify `vendor`
 * field (which always says "ColDesi"):
 *   - Isacord  → SKU `890-NNNN`
 *   - Endura   → title starts `Endura `, SKU `/^P\d+E$/i`
 *   - Royal    → SKU `/^P\d+$/i` and description mentions Royal
 *
 * Each brand is single-line; product_line uses the brand name + weight
 * ("Isacord 40", "Endura 40", "Royal 40") to leave room if a second
 * line ever ships.
 */
function extractColdesi(item: ColdesiItem): Extracted {
  const sku = item.sku ?? "";
  const title = item.title ?? "";

  let brand: string | null = null;
  let colorNumber: string | null = null;

  const isacordMatch = sku.match(/^890-(\w+)$/);
  if (isacordMatch) {
    brand = "Isacord";
    colorNumber = isacordMatch[1];
  }

  if (!brand && /^endura\b/i.test(title) && /^P\w+E$/i.test(sku)) {
    brand = "Endura";
    colorNumber = sku.replace(/E$/i, ""); // "P7167E" → "P7167"
  }

  if (
    !brand &&
    /^P\d+$/i.test(sku) &&
    !/^endura\b/i.test(title) &&
    /royal/i.test(item.description_html ?? "")
  ) {
    brand = "Royal";
    colorNumber = sku;
  }

  if (!brand || !colorNumber) return null;

  const productLine = `${brand} 40`;
  const price = item.price;

  return {
    brand,
    product_line: productLine,
    color_number: colorNumber,
    color_name: null,           // embedded in title; palette name fallback fills it
    length_yds: 5468,           // all Coldesi thread is 5000m = 5,468 yds (rounded)
    // Coldesi's three lines are all 40wt polyester by convention.
    thread_weight:
      parseThreadWeight(title) ??
      parseThreadWeight(item.description_html) ??
      40,
    material: materialFor("coldesi", productLine),
    detail: {
      sku: item.sku,
      handle: item.handle,
      title: item.title,
      online_store_url: item.online_store_url,
      product_type: item.product_type,
      tags: item.tags,
      description_html: item.description_html,
      created_at: item.created_at,
      updated_at: item.updated_at,
      published_at: item.published_at,
      image_url: item.image_url,
      product_images: item.product_images,
      grams: item.grams,
    },
    price: typeof price === "number" ? price : null,
    cost: null,
    // Shopify Storefront exposes only a boolean. Use 1 as a sentinel for
    // "in stock, exact count not published" — same pattern as Hab+Dash.
    qty: item.available ? 1 : null,
  };
}

/**
 * ThreadArt — house brand. Brand is always "ThreadArt"; product_line
 * combines fiber + put-up size ("Polyester 1000M", "Rayon 5000M") so
 * cross-vendor comparisons don't mix 1000m spools with 5000m cones.
 *
 * Filter to `product_type === "THREAD"` up front so fabric/yarn/design
 * items don't leak in. SKU encodes the color number after a `TH<PREFIX>`
 * letter block — `THPOLY934` → `934`.
 */
function extractThreadart(item: ThreadartItem): Extracted {
  if ((item.product_type ?? "").toUpperCase() !== "THREAD") return null;

  // Pull "Size_1000M (1100 yds)" out of tags — the paren'd yardage is what
  // we want; fall back to the raw M value if the yds label is missing.
  let lengthYds: number | null = null;
  let sizeTag: string | null = null;
  for (const t of item.tags) {
    if (t.startsWith("Size_")) {
      sizeTag = t.replace(/^Size_/, "");
      const yds = parseYardsFromText(sizeTag);
      if (yds !== null) lengthYds = yds;
      break;
    }
  }

  // Fiber — "Fiber_High Sheen Polyester" / "Fiber_Rayon" / "Fiber_Cotton"
  const fiberTag = item.tags.find((t) => t.startsWith("Fiber_")) ?? "";
  const fiber = fiberTag.replace(/^Fiber_/, "").trim();

  // SKU color extraction — trailing chars after the letter prefix.
  const skuRaw = item.sku ?? "";
  const skuMatch = skuRaw.match(/^[A-Za-z]+(\w+)$/);
  const colorNumber = skuMatch ? skuMatch[1] : null;
  if (!colorNumber) return null;

  const sizeLabel = sizeTag ? ` ${sizeTag.split(" ")[0]}` : "";
  const productLine = `${fiber || "Thread"}${sizeLabel}`.trim();

  return {
    brand: "ThreadArt",
    product_line: productLine,
    color_number: colorNumber,
    color_name: null,
    length_yds: lengthYds,
    // ThreadArt's machine-embroidery catalog is 40wt by default.
    thread_weight:
      parseThreadWeight(item.title) ??
      parseThreadWeight(fiberTag) ??
      40,
    // Pass the raw fiber string (richer than the synthesized line) so
    // materialFor's pattern matching has the most signal.
    material: materialFor("threadart", fiber || productLine),
    detail: {
      sku: item.sku,
      handle: item.handle,
      title: item.title,
      online_store_url: item.online_store_url,
      product_type: item.product_type,
      tags: item.tags,
      description_html: item.description_html,
      created_at: item.created_at,
      updated_at: item.updated_at,
      published_at: item.published_at,
      image_url: item.image_url,
      product_images: item.product_images,
      grams: item.grams,
    },
    price: typeof item.price === "number" ? item.price : null,
    cost: null,
    qty: item.available ? 1 : null,
  };
}

/**
 * OhMyCrafty — WooCommerce store reselling Gunold thread (only). Brand
 * is hardcoded to "Gunold" since the puller pre-filters at the API.
 *
 * Field strategy:
 *   - color_number from the leading digits of `name` ("61535 – Team Blue …"
 *     → "61535"). The SKU's last 5 digits agree, so either works.
 *   - color_name from the second `–`-delimited part, with the thread-type
 *     suffix stripped ("Team Blue Polyester Embroidery Thread" → "Team Blue").
 *   - product_line from the first category name, normalized to match
 *     Gunold direct's awkward-but-canonical format ("Poly 60 WT 1,650 YD"
 *     → "Poly 60 Wt. 1,650"). Specific lines whose Gunold direct strings
 *     don't follow the default rule (Poly Flash, Poly Sparkle) get
 *     overridden via OMC_PRODUCT_LINE_ALIASES so cross-vendor clustering
 *     still attaches OhMyCrafty's listings to the same products.
 *   - length_yds + thread_weight parsed from `name`'s suffix.
 */
function extractOhmycrafty(item: OhmycraftyItem): Extracted {
  const colorNumber = ohmycraftyColorNumberFromName(item.name);
  if (!colorNumber) return null;

  const productLine = ohmycraftyProductLine(item);
  if (!productLine) return null;

  const lengthYds =
    parseYardsFromText(item.name) ?? parseYardsFromText(productLine);
  const threadWeight =
    parseThreadWeight(item.name) ?? parseThreadWeight(productLine);

  return {
    brand: "Gunold",
    product_line: productLine,
    color_number: colorNumber,
    color_name: ohmycraftyColorName(item.name),
    length_yds: lengthYds,
    thread_weight: threadWeight,
    material: materialFor("ohmycrafty", productLine),
    detail: {
      permalink: item.permalink,
      sku: item.sku,
      slug: item.slug,
      image_url: item.image_url,
      categories: item.categories,
      currency_code: item.currency_code,
    },
    price: item.price,
    cost: null,
    qty: item.stock_qty ?? (item.is_in_stock ? 1 : null),
  };
}

function ohmycraftyColorNumberFromName(name: string): string | null {
  const m = name.match(/^\s*(\d+)\s*[–\-]/);
  if (!m) return null;
  return normColor(m[1]);
}

/**
 * Extract the human color name from the product title's middle segment,
 * stripping the trailing thread-type words OhMyCrafty appends. Examples:
 *   "61535 – Team Blue Polyester Embroidery Thread – 60 Wt. 1,650 yd. Cone"
 *     → "Team Blue"
 *   "12345 – Cherry Red Metallic Embroidery Thread – ..."
 *     → "Cherry Red"
 */
function ohmycraftyColorName(name: string): string | null {
  const parts = name.split(/\s*[–\-]\s*/);
  if (parts.length < 2) return null;
  let mid = parts[1];
  mid = mid.replace(
    /\s+(Polyester|Cotton|Metallic|Wool|Spun|Bobbin|Glitter|Sparkle|Rayon|Silk)\s+(Embroidery\s+)?Thread\s*$/i,
    "",
  );
  mid = mid.replace(/\s+Embroidery\s+Thread\s*$/i, "");
  mid = mid.replace(/\s+Bobbin\s+Thread\s*$/i, "");
  mid = mid.replace(/\s+Thread\s*$/i, "");
  return normColor(mid);
}

/**
 * Aliases for product_line strings where the default normalization
 * ("WT" → "Wt.", strip " YD") doesn't produce a string that matches
 * Gunold direct's irregular formatting. Right side is the exact string
 * Gunold direct emits today.
 */
const OMC_PRODUCT_LINE_ALIASES: Record<string, string> = {
  // Gunold direct emits no period after Wt for these:
  "Poly Flash 40 Wt. 1,100": "Poly Flash 40 Wt 1,100",
  // Gunold direct emits no space, no period:
  "Poly Sparkle 30 Wt. 1,100": "Poly Sparkle 30Wt 1,100",
};

function ohmycraftyProductLine(item: OhmycraftyItem): string | null {
  const cat = item.categories?.[0]?.name;
  if (!cat) return null;
  // Default normalize: "Poly 60 WT 1,650 YD" → "Poly 60 Wt. 1,650"
  let normalized = cat.trim();
  normalized = normalized.replace(/\s+WT\s+/g, " Wt. ");
  normalized = normalized.replace(/\s+YD\s*$/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return OMC_PRODUCT_LINE_ALIASES[normalized] ?? normalized;
}

function extractHabdashColorFromSku(sku: string | null): string | null {
  if (!sku) return null;
  const idx = sku.lastIndexOf(".");
  if (idx < 0 || idx === sku.length - 1) return null;
  return normColor(sku.slice(idx + 1));
}

function extractHabdashProductLineFromCategories(
  categories: Array<{ name: string; level: number }>,
): string | null {
  // Highest `level` = deepest / most specific category.
  // Names like "Glide (NO. 40) Trilobal Polyester" — take the part before
  // " (" when present, else the whole name.
  let best: { name: string; level: number } | null = null;
  for (const c of categories) {
    if (!best || c.level > best.level) best = c;
  }
  if (!best) return null;
  const parenIdx = best.name.indexOf(" (");
  const raw = parenIdx > 0 ? best.name.slice(0, parenIdx) : best.name;
  return normString(raw);
}

// ─── Compile ──────────────────────────────────────────────────────────────

export function compileFeeds(input: CompileInput): CompileResult {
  // Force a fresh read of thread-color-map.json on every compile — the map
  // gets rebuilt out-of-band by `scripts/build-thread-color-map.mjs` after
  // the image-sample crawler runs, and without this reset the module-level
  // `threadColorMap` cache would hold the stale copy from the first load.
  threadColorMap = null;

  const products = new Map<string, Product>();
  const listings: Listing[] = [];
  const unmatchedByVendor: Partial<Record<VendorName, number>> = {};
  const vendorsIncluded: VendorName[] = [];

  const runVendor = <T>(
    name: VendorName,
    items: T[] | undefined,
    extract: (item: T) => Extracted,
  ): void => {
    if (!items) return;
    vendorsIncluded.push(name);
    let unmatched = 0;
    for (const item of items) {
      const out = extract(item);
      if (!out) {
        unmatched += 1;
        continue;
      }
      if (out.length_yds === null) {
        // Length is part of the product key — can't form a valid Product.
        unmatched += 1;
        continue;
      }

      const key = buildProductKey(
        out.brand,
        out.product_line,
        out.color_number,
        out.length_yds,
      );

      const existing = products.get(key);
      if (!existing) {
        const palette = computePaletteLookup(
          name,
          out.product_line,
          out.color_number,
        );
        products.set(key, {
          product_key: key,
          brand: out.brand,
          product_line: out.product_line,
          color_number: out.color_number,
          color_name: out.color_name ?? palette.name,
          hex: palette.hex,
          length_yds: out.length_yds,
          thread_weight: out.thread_weight,
          material: out.material,
        });
      } else {
        // Backfill nullable fields from any vendor that supplies them.
        if (out.color_name && !existing.color_name) {
          existing.color_name = out.color_name;
        }
        if (out.thread_weight && !existing.thread_weight) {
          existing.thread_weight = out.thread_weight;
        }
        if (existing.material === "unknown" && out.material !== "unknown") {
          existing.material = out.material;
        }
        // Re-attempt palette lookup if hex is still null — the new vendor's
        // (vendor, product_line) pair may resolve to a palette key the
        // first vendor's didn't.
        if (existing.hex === null) {
          const palette = computePaletteLookup(
            name,
            out.product_line,
            out.color_number,
          );
          if (palette.hex) {
            existing.hex = palette.hex;
            if (!existing.color_name && palette.name) {
              existing.color_name = palette.name;
            }
          }
        }
      }

      listings.push({
        product_key: key,
        shopping_source: SHOPPING_SOURCE[name],
        url: urlForListing(name, out.detail),
        price: out.price,
        cost: out.cost,
        qty: out.qty,
      });
    }
    unmatchedByVendor[name] = unmatched;
    console.log(
      `[compile-feeds] ${name}: matched=${items.length - unmatched}, unmatched=${unmatched}`,
    );
  };

  runVendor("gunnold", input.gunnold?.items, extractGunnold);
  runVendor("sulky", input.sulky?.items, extractSulky);
  runVendor("allstitch", input.allstitch?.items, extractAllstitch);
  runVendor("habanddash", input.habanddash?.items, extractHabanddash);
  runVendor("coldesi", input.coldesi?.items, extractColdesi);
  runVendor("threadart", input.threadart?.items, extractThreadart);
  runVendor("ohmycrafty", input.ohmycrafty?.items, extractOhmycrafty);

  const fetchedAt = new Date().toISOString();
  const keyCount = products.size;

  // Sort products by key for stable output.
  const sortedKeys = [...products.keys()].sort();
  const orderedProducts: Record<string, Product> = {};
  for (const k of sortedKeys) orderedProducts[k] = products.get(k)!;

  // Sort listings by (brand, product_line, color_number, shopping_source)
  // for stable CSV/JSON ordering. Brand/line/color come from the joined
  // product; shopping_source is on the listing itself.
  listings.sort((a, b) => {
    const pa = products.get(a.product_key)!;
    const pb = products.get(b.product_key)!;
    const br = pa.brand.localeCompare(pb.brand);
    if (br !== 0) return br;
    const pl = pa.product_line.localeCompare(pb.product_line);
    if (pl !== 0) return pl;
    const cn = pa.color_number.localeCompare(pb.color_number, "en", {
      numeric: true,
    });
    if (cn !== 0) return cn;
    return a.shopping_source.localeCompare(b.shopping_source);
  });

  const productsFeed: ProductsFeed = {
    source: "supplies-products",
    fetchedAt,
    keyCount,
    vendorsIncluded,
    unmatchedByVendor,
    items: orderedProducts,
  };
  const listingsFeed: ListingsFeed = {
    source: "supplies-listings",
    fetchedAt,
    keyCount,
    vendorsIncluded,
    items: listings,
  };

  return {
    products: productsFeed,
    listings: listingsFeed,
    listingsCsv: toListingsCsv(listingsFeed, productsFeed),
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Listings CSV — denormalized join of listings + products so spreadsheet
 * users can read it without doing a join. One row per listing (i.e. per
 * product × shopping_source).
 */
export function toListingsCsv(
  listings: ListingsFeed,
  products: ProductsFeed,
): string {
  const headers = [
    "shopping_source",
    "brand",
    "product_line",
    "color_number",
    "color_name",
    "hex",
    "length_yds",
    "thread_weight",
    "material",
    "price",
    "cost",
    "qty",
    "url",
  ];
  const rows: string[] = [headers.join(",")];
  for (const listing of listings.items) {
    const product = products.items[listing.product_key];
    if (!product) continue;
    const cells: Record<string, unknown> = {
      shopping_source: listing.shopping_source,
      brand: product.brand,
      product_line: product.product_line,
      color_number: product.color_number,
      color_name: product.color_name,
      hex: product.hex,
      length_yds: product.length_yds,
      thread_weight: product.thread_weight,
      material: product.material,
      price: listing.price,
      cost: listing.cost,
      qty: listing.qty,
      url: listing.url,
    };
    rows.push(headers.map((h) => toCsvCell(cells[h])).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

/**
 * Cross-vendor feed compiler.
 *
 * Runs after `Promise.allSettled` in the refresh orchestrator. Takes the
 * in-memory pull results (no R2 re-read) and produces two derived feeds
 * keyed by `"<brand>|<color_number>"`:
 *
 *   - `supplies/details/current.json` — nested per-vendor detail bundle
 *     (name, SKU, image, description, categories, etc.). One entry per
 *     (brand, color); `vendors: { gunnold: {...}, sulky: {...}, ... }` holds
 *     each carrier's view of that same thread color. Excludes price, cost,
 *     quantity, stock, availability fields — those live in the pricing feed.
 *
 *   - `supplies/pricing/current.json` — flat, one row per (brand, color),
 *     with vendor-prefixed columns so CSV export is trivial. Identifier
 *     columns: `brand`, `color_number`, `hex`. Then three columns per
 *     vendor: `<vendor>_price`, `<vendor>_cost`, `<vendor>_qty`. Always-null
 *     columns (most vendors don't expose cost) are retained so the output
 *     header is stable regardless of which vendors ran this time.
 *
 * The `hex` column is looked up per key against the bundled Ink/Stitch GPL
 * palettes (`src/app/embroidery/_lib/inkstitch/palettes/*.gpl`) via a
 * heuristic brand→palette mapping. Misses return null and can be fixed by
 * adjusting `paletteKeyFor()` or adding more palette files.
 *
 * Neither feed has a dated archive — they're derived from per-vendor archives
 * which are the source of truth for history. Rerunning the compile against
 * any past date's vendor archives would regenerate these files.
 *
 * Extraction strategy: each vendor has its own extractor that returns either
 * `{ brand, color_number, color_name, detail, pricing }` or `null` for items
 * that can't be confidently matched (kits, tools, digital products, etc.).
 * Unmatched counts are surfaced in the output envelope so we can iterate on
 * per-vendor parsing rules.
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

// ─── Types ────────────────────────────────────────────────────────────────

/** Every wired vendor — keep in sync with orchestrator VENDORS list. */
export const VENDOR_NAMES = [
  "gunnold",
  "sulky",
  "allstitch",
  "habanddash",
  "coldesi",
  "threadart",
] as const;
export type VendorName = (typeof VENDOR_NAMES)[number];

/**
 * One row per (shopping_source, brand, color, vendor).
 *   - `shopping_source` = display name of the place you buy from (1:1 with
 *     `vendor`, the scraper key). "ColDesi", "AllStitch", etc.
 *   - `manufacturer` = who actually made the thread, inferred from the
 *     product-line string. Often the same as shopping_source for maker-
 *     direct vendors (Sulky→Sulky, Gunold→Gunold); different for resellers
 *     (AllStitch→Madeira, Hab+Dash→Fil-Tec, ColDesi→Isacord/Endura/Royal).
 *   - `brand` = the actual product line ("Isacord", "Polyneon 40-440 yd",
 *     "Glide", "12 Wt. Cotton 2100 Yd. Jumbo Cones").
 */
export type PricingRow = {
  shopping_source: string;
  manufacturer: string | null;
  brand: string;
  color_number: string;
  hex: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  vendor: VendorName;
  price: number | null;
  cost: number | null;
  qty: number | null;
};

export type DetailsEntry = {
  shopping_source: string;
  manufacturer: string | null;
  brand: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  vendors: Partial<Record<VendorName, Record<string, unknown>>>;
};

export type DetailsFeed = {
  source: "supplies-details";
  fetchedAt: string;
  keyCount: number;
  vendorsIncluded: VendorName[];
  unmatchedByVendor: Partial<Record<VendorName, number>>;
  items: Record<string, DetailsEntry>;
};

export type PricingFeed = {
  source: "supplies-pricing";
  fetchedAt: string;
  keyCount: number;
  vendorsIncluded: VendorName[];
  items: PricingRow[];
};

export type CompileInput = Partial<{
  gunnold: GunnoldPullResult;
  sulky: SulkyPullResult;
  allstitch: AllStitchPullResult;
  habanddash: HabanddashPullResult;
  coldesi: ColdesiPullResult;
  threadart: ThreadartPullResult;
}>;

export type CompileResult = {
  details: DetailsFeed;
  pricing: PricingFeed;
  pricingCsv: string;
};

/**
 * Per-item extractor output. `null` for items that can't be cleanly mapped
 * onto a (brand, color) — extractor bails, caller increments unmatched.
 */
type Extracted = {
  manufacturer: string | null;
  brand: string;
  color_number: string;
  color_name: string | null;
  length_yds: number | null;
  thread_weight: number | null;
  detail: Record<string, unknown>;
  price: number | null;
  cost: number | null;
  qty: number | null;
} | null;

// ─── Helpers ──────────────────────────────────────────────────────────────

function normBrand(s: string | null | undefined): string | null {
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

function keyOf(brand: string, color: string): string {
  return `${brand}|${color}`;
}

function makePricingRow(
  vendor: VendorName,
  manufacturer: string | null,
  brand: string,
  color: string,
  hex: string | null,
  length_yds: number | null,
  thread_weight: number | null,
  price: number | null,
  cost: number | null,
  qty: number | null,
): PricingRow {
  return {
    shopping_source: SHOPPING_SOURCE[vendor],
    manufacturer,
    brand,
    color_number: color,
    hex,
    length_yds,
    thread_weight,
    vendor,
    price,
    cost,
    qty,
  };
}

/**
 * Map each scraper's `VendorName` to its public-facing shopping-source
 * label. This is the column header in the pivot table and the name that
 * shows in the dropdown. Kept simple + explicit — one row per vendor,
 * no regex, no inference.
 */
const SHOPPING_SOURCE: Record<VendorName, string> = {
  gunnold: "Gunold",
  sulky: "Sulky",
  allstitch: "AllStitch",
  habanddash: "Hab+Dash",
  coldesi: "ColDesi",
  threadart: "ThreadArt",
};

/**
 * Infer the thread's actual manufacturer from (vendor, product-line).
 * Often the same as the shopping source for maker-direct stores (Sulky
 * sells Sulky, Gunold sells Gunold), but resellers like AllStitch,
 * Hab+Dash, and ColDesi carry mixed catalogs, so we match on the brand
 * string to pin down who really made it.
 */
function manufacturerFor(
  vendor: VendorName,
  rawBrand: string,
): string | null {
  const b = rawBrand.toLowerCase();
  switch (vendor) {
    case "gunnold":
      return "Gunold";
    case "sulky":
      return "Sulky";
    case "habanddash":
      // Hab+Dash is Fil-Tec's primary retail channel; their thread catalog
      // is effectively Glide + Magna-Glide. Non-Fil-Tec items (kits,
      // accessories) fall through.
      if (/glide|magna|cairo-quilt|premo-soft/.test(b)) return "Fil-Tec";
      return null;
    case "allstitch":
      // AllStitch Thread Type tags are almost all Madeira lines; they
      // occasionally surface Fil-Tec bobbins / Gunold stabilizers.
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
      // Brand *is* the manufacturer for Coldesi's thread lines — Isacord,
      // Endura, Royal are each the actual maker. Detection is handled by
      // the extractor (via title/SKU patterns); if we get here, `rawBrand`
      // is already one of those names.
      if (/isacord/.test(b)) return "Isacord";
      if (/endura/.test(b)) return "Endura";
      if (/royal/.test(b)) return "Royal";
      return null;
    case "threadart":
      // ThreadArt sells only their house brand.
      return "ThreadArt";
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
 * usually 12, 30, 35, 40, 50, 60, 80, 100, 120, but we accept anything in a
 * reasonable range to avoid missing unusual cases.
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
  // Last-resort fallback: first 2-3 digit number in the string.
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
 * Map a vendor's raw brand string to the Ink/Stitch palette key that holds
 * the authoritative hex values for that thread line. Rules are heuristic
 * (substring match on the extracted brand) and expected to miss — unknown
 * mappings return null and the entry gets `hex: null` downstream.
 */
function paletteKeyFor(
  vendor: VendorName,
  rawBrand: string,
): string | null {
  const b = rawBrand.toLowerCase();
  switch (vendor) {
    case "gunnold":
      // Gunold's thread catalog is all one palette; "Poly 40 Wt. 5,500",
      // "PolyFire 40 Wt. 5,500" etc. all share the 61xxx numbering.
      if (/poly/.test(b)) return "gunold-polyester";
      return null;
    case "sulky":
      if (/rayon/.test(b)) return "sulky-rayon";
      if (/cotton|poly|polylite|poly\s*deco|filaine/.test(b))
        return "sulky-polyester";
      return null;
    case "allstitch":
      // AllStitch's Thread Type tags: "Rayon 40-220 yd", "Polyneon 40-440 yd",
      // "Metallic 40-220 yd", etc. Nearly all AllStitch thread is Madeira.
      if (/polyneon/.test(b)) return "madeira-polyneon";
      if (/rayon/.test(b)) return "madeira-rayon";
      if (/burmilana/.test(b)) return "madeira-burmilana";
      if (/matt/.test(b)) return "madeira-matt";
      return null;
    case "habanddash":
      // Hab+Dash's thread is Fil-Tec (Glide, Magna-Glide).
      if (/glide/.test(b)) return "fil-tec-glide";
      return null;
    case "coldesi":
      // Isacord and Royal both have Ink/Stitch palettes — authoritative hex
      // lookup works. Endura has no published palette; those fall through
      // to image-sampled hex only.
      if (/isacord/.test(b)) return "isacord-polyester";
      if (/royal/.test(b)) return "royal-polyester";
      return null;
    case "threadart":
      return "threadart";
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
 * Gunold crossmatch PDFs. Single source of truth for (brand, color) → hex
 * at runtime; no per-palette file reading here.
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
 * Look up both the palette hex AND the palette color name for a (brand,
 * color). Vendors that don't expose `color_name` (AllStitch, Hab+Dash) can
 * use the palette's name as a fallback — e.g. Ink/Stitch's `gunold-polyester`
 * palette has `{hex: '#e4002b', name: 'Berry Red', number: '61401'}`.
 *
 * Palette key path wins over the raw-brand (image-sample) path because the
 * sampler only stores hex, not names.
 */
function computePaletteLookup(
  vendor: VendorName,
  rawBrand: string,
  colorNumber: string,
): { hex: string | null; name: string | null } {
  const map = getThreadColorMap();
  const paletteKey = paletteKeyFor(vendor, rawBrand);
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
  const rawEntry = map[`${rawBrand}|${colorNumber}`];
  return {
    hex: rawEntry?.hex ?? null,
    name: rawEntry?.name ?? null,
  };
}

// ─── Per-vendor extractors ────────────────────────────────────────────────

/**
 * Gunnold — `brand` is direct. For color we use the last 5 digits of
 * `stock_number` rather than the `color_number` field: Gunnold's
 * `color_number` strips the line prefix (e.g. "1065") but the Ink/Stitch
 * Gunold palette uses the full 5-digit code (e.g. "61065"). `stock_number`
 * like "96061065" has the palette code baked into the tail. Items without a
 * stock_number (kits, tools, stabilizers) fall back to the raw color_number,
 * which usually means no palette match but preserves the entry.
 * `last_cost` chosen over standard/average as the more up-to-date cost signal.
 */
function extractGunnold(item: GunnoldItem): Extracted {
  const brand = normBrand(item.brand);
  const color =
    gunnoldColorFromStockNumber(item.stock_number) ?? normColor(item.color_number);
  if (!brand || !color) return null;

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
    manufacturer: manufacturerFor("gunnold", brand),
    brand,
    color_number: color,
    color_name: normColor(color_name),
    length_yds: toFiniteNumber(yardage) ?? parseYardsFromText(brand),
    thread_weight:
      parseThreadWeight(item.thread_weight) ?? parseThreadWeight(brand),
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
 * Sulky — `brand_name` and `color_number` (custom field) are direct.
 * Storefront API exposes no cost. Many items (~73% have color_number); the
 * rest are digital products, assortments, accessories — skip.
 */
function extractSulky(item: SulkyItem): Extracted {
  const brand = normBrand(item.brand_name);
  // Sulky stores some colors with leading zeros ("0502") while Ink/Stitch's
  // palette has them plain ("502"). Normalize to no-leading-zeros for both
  // the key and the palette lookup.
  const color = stripLeadingZeros(normColor(item.color_number));
  if (!brand || !color) return null;

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
    manufacturer: manufacturerFor("sulky", brand),
    brand,
    color_number: color,
    color_name: normColor(color_name),
    length_yds: toFiniteNumber(yardage) ?? parseYardsFromText(brand),
    thread_weight:
      parseThreadWeight(item.thread_weight) ?? parseThreadWeight(brand),
    detail,
    price: typeof price === "number" ? price : null,
    cost: null,
    qty: typeof available_to_sell === "number" ? available_to_sell : null,
  };
}

/**
 * AllStitch — most items are Madeira threads resold via Shopify. Strategy:
 *   - Brand comes from the `Thread Type_<series>` tag when present.
 *   - Color number comes from the SKU suffix after the last dash (pattern
 *     consistent across 922-N1977, 910-1304, 9135-8670, 9845-1770, etc.).
 * Skip items without both signals (foam, needles, hoops, bobbins, etc.).
 */
function extractAllstitch(item: AllStitchItem): Extracted {
  const threadTypeTag = item.tags?.find((t) => t.startsWith("Thread Type_"));
  const brand = threadTypeTag ? normBrand(threadTypeTag.replace("Thread Type_", "")) : null;
  const color = extractAllstitchColorNumber(item.sku);
  if (!brand || !color) return null;

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
    manufacturer: manufacturerFor("allstitch", brand),
    brand,
    color_number: color,
    color_name: null, // AllStitch doesn't expose a separate color_name field
    length_yds:
      parseYardsFromText(item.title) ??
      parseYardsFromText(item.variant_title) ??
      parseYardsFromText(brand),
    thread_weight:
      parseThreadWeight(brand) ??
      parseThreadWeight(item.title) ??
      parseThreadWeight(item.product_type),
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
 * Brand comes from the deepest (highest level) category containing the series
 * marker, e.g. `Glide (NO. 40) Trilobal Polyester`. Skip items whose SKU
 * doesn't match the dotted pattern (thread kits, accessories).
 */
function extractHabanddash(item: HabanddashItem): Extracted {
  const color = extractHabdashColorFromSku(item.sku);
  const brand = extractHabdashBrandFromCategories(item.categories);
  if (!brand || !color) return null;

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
    manufacturer: manufacturerFor("habanddash", brand),
    brand,
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
      parseThreadWeight(brand),
    detail,
    price,
    cost: null,
    // Magento public API only exposes `only_x_left_in_stock` when stock is
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
 * Coldesi carries three thread brands under one storefront. Brand comes
 * from the title/SKU pattern, not the Shopify `vendor` field (which always
 * says "ColDesi"):
 *   - Isacord  → title `"0020 Black Poly 5K meter / #40wt"`, SKU `"890-0020"`
 *   - Endura   → title starts `"Endura "`, SKU matches `/^P\d+E$/i`
 *   - Royal    → title doesn't start with Endura, SKU matches `/^P\d+$/i`
 * Anything that doesn't match (machines, stabilizers, inks, merch) returns
 * null — those items are excluded from the feed.
 *
 * Color number = the numeric part of the SKU:
 *   - Isacord `"890-0020"` → `"0020"` (matches Ink/Stitch palette)
 *   - Endura  `"P7167E"`    → `"P7167"` (stable brand-local identifier)
 *   - Royal   `"P256"`      → `"P256"`
 */
function extractColdesi(item: ColdesiItem): Extracted {
  const sku = item.sku ?? "";
  const title = item.title ?? "";

  let brand: string | null = null;
  let colorNumber: string | null = null;

  // Isacord: SKU `890-NNNN`
  const isacordMatch = sku.match(/^890-(\w+)$/);
  if (isacordMatch) {
    brand = "Isacord";
    colorNumber = isacordMatch[1];
  }

  // Endura: title begins with "Endura " and SKU ends in "E"
  if (!brand && /^endura\b/i.test(title) && /^P\w+E$/i.test(sku)) {
    brand = "Endura";
    colorNumber = sku.replace(/E$/i, ""); // "P7167E" → "P7167"
  }

  // Royal: SKU is PNNNN (no trailing E), body mentions Royal. Title does
  // NOT start with Endura/Isacord keywords.
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

  const price = item.price;
  const mfg = manufacturerFor("coldesi", brand);

  return {
    manufacturer: mfg,
    brand,
    color_number: colorNumber,
    color_name: null, // Embedded in title; palette name fallback fills it in.
    length_yds: 5468, // All Coldesi thread is 5000m = 5,468 yds (rounded).
    // Coldesi's three thread lines are all 40wt polyester by convention;
    // fall back to 40 when neither the title nor the description spells
    // the weight out explicitly (Endura / Royal titles rarely do).
    thread_weight:
      parseThreadWeight(title) ??
      parseThreadWeight(item.description_html) ??
      40,
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
 * ThreadArt — house-brand Shopify store. Single vendor, single manufacturer,
 * but multiple product lines (polyester 1000m, polyester 5000m, rayon, etc.)
 * that get distinguished via the `Size_<N>M (<N> yds)` tag + fiber tag.
 *
 * We filter to `product_type === "THREAD"` up front so fabric/yarn/design
 * items don't leak into the feed. The SKU encodes the color number after
 * a `TH<PREFIX>` letter block — `THPOLY934` → `934`.
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

  // SKU color extraction — take trailing digits after the letter prefix.
  // Leaves alphanumeric suffixes (rare) intact.
  const skuRaw = item.sku ?? "";
  const skuMatch = skuRaw.match(/^[A-Za-z]+(\w+)$/);
  const colorNumber = skuMatch ? skuMatch[1] : null;
  if (!colorNumber) return null;

  // Brand = ThreadArt line, distinguished by fiber + size so cross-vendor
  // comparisons don't mix 1000m spools with 5000m cones of the same color.
  const sizeLabel = sizeTag ? ` ${sizeTag.split(" ")[0]}` : "";
  const brand = `ThreadArt ${fiber || "Thread"}${sizeLabel}`.trim();

  const mfg = manufacturerFor("threadart", brand);

  return {
    manufacturer: mfg,
    brand,
    color_number: colorNumber,
    color_name: null,
    length_yds: lengthYds,
    // ThreadArt's machine-embroidery catalog is 40wt by default. If the
    // fiber tag hints at a bobbin / 60wt line, parse gets a chance at
    // the title first.
    thread_weight:
      parseThreadWeight(item.title) ??
      parseThreadWeight(fiberTag) ??
      40,
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

function extractHabdashColorFromSku(sku: string | null): string | null {
  if (!sku) return null;
  const idx = sku.lastIndexOf(".");
  if (idx < 0 || idx === sku.length - 1) return null;
  return normColor(sku.slice(idx + 1));
}

function extractHabdashBrandFromCategories(
  categories: Array<{ name: string; level: number }>,
): string | null {
  // Highest `level` = deepest / most specific category.
  // Names like "Glide (NO. 40) Trilobal Polyester" — take the part before " ("
  // when present, else the whole name.
  let best: { name: string; level: number } | null = null;
  for (const c of categories) {
    if (!best || c.level > best.level) best = c;
  }
  if (!best) return null;
  const parenIdx = best.name.indexOf(" (");
  const raw = parenIdx > 0 ? best.name.slice(0, parenIdx) : best.name;
  return normBrand(raw);
}

// ─── Compile ──────────────────────────────────────────────────────────────

export function compileFeeds(input: CompileInput): CompileResult {
  // Force a fresh read of thread-color-map.json on every compile — the map
  // gets rebuilt out-of-band by `scripts/build-thread-color-map.mjs` after
  // the image-sample crawler runs, and without this reset the module-level
  // `threadColorMap` cache would hold the stale copy from the first load.
  threadColorMap = null;

  const details: Record<string, DetailsEntry> = {};
  // Keyed by `${brand}|${color_number}|${vendor}` so multiple raw items that
  // extract to the same (brand, color, vendor) triple collapse to one row.
  // We prefer the row that carries the most useful data (non-null price).
  const pricingByTriple = new Map<string, PricingRow>();
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
      const k = keyOf(out.brand, out.color_number);

      if (!details[k]) {
        const palette = computePaletteLookup(name, out.brand, out.color_number);
        details[k] = {
          shopping_source: SHOPPING_SOURCE[name],
          manufacturer: out.manufacturer,
          brand: out.brand,
          color_number: out.color_number,
          // Prefer vendor-supplied color name; fall back to palette name
          // (Ink/Stitch, Sulky RGB PDF) when the vendor doesn't expose one.
          color_name: out.color_name ?? palette.name,
          hex: palette.hex,
          length_yds: out.length_yds,
          thread_weight: out.thread_weight,
          vendors: {},
        };
      } else {
        // Backfill missing fields from any vendor that supplies them.
        if (out.color_name && !details[k].color_name) {
          details[k].color_name = out.color_name;
        }
        if (out.manufacturer && !details[k].manufacturer) {
          details[k].manufacturer = out.manufacturer;
        }
        if (out.length_yds && !details[k].length_yds) {
          details[k].length_yds = out.length_yds;
        }
        if (out.thread_weight && !details[k].thread_weight) {
          details[k].thread_weight = out.thread_weight;
        }
      }
      details[k].vendors[name] = out.detail;

      const tripleKey = `${out.brand}|${out.color_number}|${name}`;
      const existing = pricingByTriple.get(tripleKey);
      const candidate = makePricingRow(
        name,
        details[k].manufacturer,
        out.brand,
        out.color_number,
        details[k].hex,
        details[k].length_yds,
        details[k].thread_weight,
        out.price,
        out.cost,
        out.qty,
      );
      // Prefer the row with the most real data: price > qty > cost > first-seen.
      if (!existing) {
        pricingByTriple.set(tripleKey, candidate);
      } else {
        const score = (r: PricingRow) =>
          (r.price !== null ? 4 : 0) +
          (r.qty !== null ? 2 : 0) +
          (r.cost !== null ? 1 : 0);
        if (score(candidate) > score(existing)) {
          pricingByTriple.set(tripleKey, candidate);
        }
      }
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

  const fetchedAt = new Date().toISOString();
  const keyCount = Object.keys(details).length;

  // Sort details dict by key for stable output.
  const sortedKeys = Object.keys(details).sort();
  const orderedDetails: Record<string, DetailsEntry> = {};
  for (const k of sortedKeys) orderedDetails[k] = details[k];

  // Also: backfill manufacturer/length/hex on pricing rows in case the row
  // landed in the Map before the matching detail entry had those fields
  // (happens when multiple vendors contribute to the same key).
  const pricingRows: PricingRow[] = [];
  for (const row of pricingByTriple.values()) {
    const detail = details[`${row.brand}|${row.color_number}`];
    if (detail) {
      row.manufacturer = detail.manufacturer;
      row.length_yds = detail.length_yds;
      row.thread_weight = detail.thread_weight;
      row.hex = detail.hex;
    }
    pricingRows.push(row);
  }

  // Sort pricing rows by (manufacturer, brand, color_number, vendor) so CSV
  // + JSON orderings are deterministic and scannable.
  pricingRows.sort((a, b) => {
    const m = (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "");
    if (m !== 0) return m;
    const br = a.brand.localeCompare(b.brand);
    if (br !== 0) return br;
    const cn = a.color_number.localeCompare(b.color_number, "en", {
      numeric: true,
    });
    if (cn !== 0) return cn;
    return a.vendor.localeCompare(b.vendor);
  });

  const pricingFeed: PricingFeed = {
    source: "supplies-pricing",
    fetchedAt,
    keyCount,
    vendorsIncluded,
    items: pricingRows,
  };

  return {
    details: {
      source: "supplies-details",
      fetchedAt,
      keyCount,
      vendorsIncluded,
      unmatchedByVendor,
      items: orderedDetails,
    },
    pricing: pricingFeed,
    pricingCsv: toPricingCsv(pricingFeed),
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toPricingCsv(pricing: PricingFeed): string {
  const headers = [
    "shopping_source",
    "manufacturer",
    "brand",
    "color_number",
    "hex",
    "length_yds",
    "thread_weight",
    "vendor",
    "price",
    "cost",
    "qty",
  ];
  const rows: string[] = [headers.join(",")];
  for (const row of pricing.items) {
    const r = row as unknown as Record<string, unknown>;
    rows.push(headers.map((h) => toCsvCell(r[h])).join(","));
  }
  // CSV convention: CRLF line endings.
  return rows.join("\r\n") + "\r\n";
}

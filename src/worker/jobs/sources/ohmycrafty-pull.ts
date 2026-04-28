/**
 * OhMyCrafty (ohmycrafty.com) — vendor inventory pull.
 *
 * Platform: WooCommerce. Public Store API at `/wp-json/wc/store/products`;
 * no auth. Paginated by `?per_page=100&page=N`. We pre-filter to Gunold
 * (brand_id=1597) at the API level — OhMyCrafty's main business is digital
 * embroidery designs (~6K of 7,462 catalog items), and only the 1,539
 * Gunold-branded items are thread.
 *
 * Brand-tagging is explicit on each product (`brands: [{name: "Gunold"}]`),
 * so the extractor can hardcode brand="Gunold" with confidence — no name-
 * pattern inference needed. Color number lives in the SKU's last 5 digits
 * AND in the product name's leading number.
 *
 * Product line is derived from the first category name (e.g. "Poly 60 WT
 * 1,650 YD") and lightly normalized in the extractor to match Gunold
 * direct's product_line format ("Poly 60 Wt. 1,650") so cross-vendor
 * clustering attaches OhMyCrafty's listings onto the same product entries
 * Gunold direct already creates.
 */

const API_URL = "https://ohmycrafty.com/wp-json/wc/store/products";
const GUNOLD_BRAND_ID = 1597;
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 3000;
const MAX_PAGES = 50; // 1,539 Gunold items / 100 per page = ~16 pages; cap with headroom

// ─── API shapes ───────────────────────────────────────────────────────────

type ApiImage = {
  id: number;
  src: string;
  thumbnail?: string;
  name?: string;
  alt?: string;
};

type ApiCategory = {
  id: number;
  name: string;
  slug: string;
  link: string;
};

type ApiBrand = {
  id: number;
  name: string;
  slug: string;
  link: string;
};

type ApiPrices = {
  /** Stored in minor units — divide by 10^currency_minor_unit for display. */
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code: string;
  currency_minor_unit: number;
};

type ApiStockAvailability = {
  text: string; // "8 in stock", "Out of stock", etc.
  class: string;
};

type ApiProduct = {
  id: number;
  name: string; // may contain HTML entities like &#8211;
  slug: string;
  permalink: string;
  sku: string;
  short_description: string;
  description: string;
  on_sale: boolean;
  prices: ApiPrices;
  price_html: string;
  images: ApiImage[];
  categories: ApiCategory[];
  brands: ApiBrand[];
  is_purchasable: boolean;
  is_in_stock: boolean;
  is_on_backorder: boolean;
  low_stock_remaining: number | null;
  stock_availability: ApiStockAvailability;
};

// ─── Curated output shape ────────────────────────────────────────────────

type CuratedCategory = { name: string; slug: string };

export type OhmycraftyItem = {
  // Identity
  id: number;
  sku: string;
  name: string;
  slug: string;
  permalink: string;

  // Categorization
  brand_name: string | null; // first brand from brands[] (always "Gunold" with our filter)
  categories: CuratedCategory[];

  // Copy
  short_description: string | null;
  description_html: string | null;

  // Image
  image_url: string | null;

  // Pricing — already converted to display units (e.g. 5.30 not 530)
  price: number | null;
  regular_price: number | null;
  sale_price: number | null;
  on_sale: boolean;
  currency_code: string;

  // Availability
  is_in_stock: boolean;
  /** Parsed from stock_availability.text "N in stock" — null when not exposed. */
  stock_qty: number | null;
};

export type OhmycraftyPullResult = {
  source: "ohmycrafty";
  fetchedAt: string;
  endpoints: { api: string };
  itemsTotal: number;
  items: OhmycraftyItem[];
};

// ─── Fetch helpers ───────────────────────────────────────────────────────

async function fetchPage(page: number): Promise<ApiProduct[]> {
  const url = `${API_URL}?brand=${GUNOLD_BRAND_ID}&per_page=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `ohmycrafty wc/store/products fetch failed (page ${page}): ${res.status} ${res.statusText}`,
    );
  }
  const payload = (await res.json()) as ApiProduct[];
  return Array.isArray(payload) ? payload : [];
}

// ─── Curation ────────────────────────────────────────────────────────────

/**
 * WooCommerce returns prices as integer strings in minor units
 * (e.g. "530" = $5.30 when currency_minor_unit is 2). Convert to
 * display units up-front so downstream never has to think about it.
 */
function toMoney(s: string | undefined, minorUnit: number): number | null {
  if (s === undefined || s === null || s === "") return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n / Math.pow(10, minorUnit);
}

/**
 * Decode the HTML entities WordPress emits in product names. The catalog
 * uses `&#8211;` for en-dashes and `&amp;`, `&#8217;` for apostrophes.
 * Cheap manual decode rather than pulling in a parser library — the
 * vocabulary is small and stable.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Stock count from `stock_availability.text` like "8 in stock". Returns
 * null when the text doesn't carry a number ("In stock" / "Out of stock"
 * are common for vendors that don't publish exact counts).
 */
function parseStockQty(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*in stock/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function curateProduct(product: ApiProduct): OhmycraftyItem {
  const minor = product.prices.currency_minor_unit ?? 2;
  return {
    id: product.id,
    sku: product.sku,
    name: decodeEntities(product.name),
    slug: product.slug,
    permalink: product.permalink,
    brand_name: product.brands?.[0]?.name ?? null,
    categories: (product.categories ?? []).map((c) => ({
      name: c.name,
      slug: c.slug,
    })),
    short_description: product.short_description
      ? decodeEntities(product.short_description)
      : null,
    description_html: product.description ?? null,
    image_url: product.images?.[0]?.src ?? null,
    price: toMoney(product.prices.price, minor),
    regular_price: toMoney(product.prices.regular_price, minor),
    sale_price: toMoney(product.prices.sale_price, minor),
    on_sale: product.on_sale === true,
    currency_code: product.prices.currency_code ?? "USD",
    is_in_stock: product.is_in_stock === true,
    stock_qty: parseStockQty(product.stock_availability?.text),
  };
}

// ─── Public entrypoint ───────────────────────────────────────────────────

export async function pullOhmycrafty(): Promise<OhmycraftyPullResult> {
  const items: OhmycraftyItem[] = [];
  let page = 1;
  let pagesSeen = 0;

  while (page <= MAX_PAGES) {
    const products = await fetchPage(page);
    pagesSeen += 1;
    if (products.length === 0) break;

    for (const product of products) items.push(curateProduct(product));
    page += 1;

    if (page <= MAX_PAGES) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  if (pagesSeen >= MAX_PAGES) {
    console.warn(
      `[ohmycrafty-pull] hit MAX_PAGES=${MAX_PAGES} cap — catalog may be truncated`,
    );
  }

  return {
    source: "ohmycrafty",
    fetchedAt: new Date().toISOString(),
    endpoints: { api: API_URL },
    itemsTotal: items.length,
    items,
  };
}

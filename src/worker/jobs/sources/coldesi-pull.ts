/**
 * Coldesi (shop.coldesi.com) — vendor inventory pull.
 *
 * Platform: Shopify. Public `products.json` endpoint; no auth. Paginated by
 * `?page=N&limit=250`. We walk every page until an empty response.
 *
 * Coldesi carries three thread brands under their own store label:
 *   - Isacord — title `"0020 Black Poly 5K meter / #40wt"`, SKU `"890-0020"`
 *   - Endura  — title `"Endura <COLOR> PNNNNE Polyester Thread"`, SKU `"PNNNNE"`
 *   - Royal   — title `"<COLOR> PNNNN Polyester Thread"`, SKU `"PNNNN"`
 * Brand detection happens in the extractor (compile-feeds.ts), not here —
 * the puller just preserves all fields so downstream can decide.
 *
 * Non-thread items (embroidery machines, inks, stabilizers, accessories,
 * merch) are included in the raw pull and filtered out by the extractor
 * via brand-detection failure (returns null).
 *
 * `body_html` often contains useful cross-brand conversion text
 * ("Madeira Thread conversion = 918-1800", "Item P256 - PMS 540C"); we
 * preserve it so future crossmatch extraction can mine it.
 *
 * Shape note: Shopify variables can have multiple variants; we emit one
 * curated row per variant, same pattern as AllStitch.
 */

const API_URL = "https://shop.coldesi.com/products.json";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

// Coldesi is Shopify — not cost-limited the same way AllStitch or Sulky are,
// but 3s spacing keeps us polite and consistent with the other vendors.
const PAGE_SIZE = 250;
const PAGE_DELAY_MS = 3000;
const MAX_PAGES = 200;

// ─── API shapes ───────────────────────────────────────────────────────────

type ApiImage = {
  id: number;
  src: string;
  width: number | null;
  height: number | null;
  position: number | null;
  variant_ids: number[];
};

type ApiVariant = {
  id: number;
  title: string;
  sku: string | null;
  price: string; // Shopify returns price as string
  compare_at_price: string | null;
  grams: number | null;
  available: boolean;
  taxable: boolean;
  requires_shipping: boolean;
  position: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  featured_image: ApiImage | null;
};

type ApiOption = { name: string; position: number; values: string[] };

type ApiProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
  variants: ApiVariant[];
  images: ApiImage[];
  options: ApiOption[];
};

type ApiResponse = { products: ApiProduct[] };

// ─── Curated output shapes ───────────────────────────────────────────────

type CuratedImage = {
  src: string;
  width: number | null;
  height: number | null;
};

export type ColdesiItem = {
  // Identity
  sku: string | null;
  handle: string;
  title: string;
  variant_title: string;
  online_store_url: string;

  // Categorization
  product_type: string | null;
  tags: string[];

  // Copy — body_html preserved verbatim; it holds the cross-brand conversion
  // strings ("Madeira Thread conversion = 918-1800", "PMS 540C") that future
  // passes can mine.
  description_html: string | null;

  // Dates
  created_at: string;
  updated_at: string;
  published_at: string | null;

  // Image
  image_url?: string;
  image_width?: number | null;
  image_height?: number | null;
  product_images: CuratedImage[];

  // Pricing (variant-level)
  price?: number;
  compare_at_price?: number;

  // Availability — Shopify Storefront doesn't expose numeric inventory on
  // products.json; only a boolean.
  available: boolean;

  // Physical
  grams: number | null;
};

export type ColdesiPullResult = {
  source: "coldesi";
  fetchedAt: string;
  endpoints: { api: string };
  itemsTotal: number;
  items: ColdesiItem[];
};

// ─── Fetch helpers ───────────────────────────────────────────────────────

async function fetchPage(
  page: number,
): Promise<{ products: ApiProduct[] }> {
  const url = `${API_URL}?limit=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `coldesi products.json fetch failed (page ${page}): ${res.status} ${res.statusText}`,
    );
  }
  const payload = (await res.json()) as ApiResponse;
  return { products: payload.products ?? [] };
}

// ─── Curation ────────────────────────────────────────────────────────────

function toMoney(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function curateImage(img: ApiImage): CuratedImage {
  return { src: img.src, width: img.width, height: img.height };
}

function curateProductVariants(product: ApiProduct): ColdesiItem[] {
  const productImages = product.images.map(curateImage);
  const onlineStoreUrl = `https://shop.coldesi.com/products/${product.handle}`;

  return product.variants.map((variant) => {
    const image = variant.featured_image ?? product.images[0];
    const price = toMoney(variant.price);
    const compareAt = toMoney(variant.compare_at_price);

    const item: ColdesiItem = {
      sku: variant.sku,
      handle: product.handle,
      title: product.title,
      variant_title: variant.title,
      online_store_url: onlineStoreUrl,
      product_type: product.product_type || null,
      tags: product.tags,
      description_html: product.body_html,
      created_at: product.created_at,
      updated_at: product.updated_at,
      published_at: product.published_at,
      product_images: productImages,
      available: variant.available,
      grams: typeof variant.grams === "number" ? variant.grams : null,
    };

    if (image) {
      item.image_url = image.src;
      item.image_width = image.width;
      item.image_height = image.height;
    }

    if (price !== undefined) item.price = price;
    if (compareAt !== undefined) item.compare_at_price = compareAt;

    return item;
  });
}

// ─── Public entrypoint ───────────────────────────────────────────────────

export async function pullColdesi(): Promise<ColdesiPullResult> {
  const items: ColdesiItem[] = [];
  let page = 1;
  let pagesSeen = 0;

  while (page <= MAX_PAGES) {
    const { products } = await fetchPage(page);
    pagesSeen += 1;
    if (products.length === 0) break;

    for (const product of products) {
      for (const row of curateProductVariants(product)) items.push(row);
    }
    page += 1;

    if (page <= MAX_PAGES) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  if (pagesSeen >= MAX_PAGES) {
    console.warn(
      `[coldesi-pull] hit MAX_PAGES=${MAX_PAGES} cap — catalog may be truncated`,
    );
  }

  return {
    source: "coldesi",
    fetchedAt: new Date().toISOString(),
    endpoints: { api: API_URL },
    itemsTotal: items.length,
    items,
  };
}

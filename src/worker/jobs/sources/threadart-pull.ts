/**
 * ThreadArt (threadart.com) — vendor inventory pull.
 *
 * Platform: Shopify. Public `/products.json` endpoint, no auth; paginate via
 * `?page=N&limit=250`. Walk every page until an empty response.
 *
 * ThreadArt is their own house brand — every product has
 * `vendor: "ThreadArt"`. They sell thread, yarn, fabric, embroidery designs,
 * bags, and more, so the curated shape keeps raw fields and the compile-feeds
 * extractor filters to `product_type === "THREAD"` + brand-code SKUs.
 *
 * Product lines (inferred from tags like `Size_1000M (1100 yds)` +
 * `Fiber_High Sheen Polyester`):
 *   - Polyester 1000m cones
 *   - Polyester 5000m cones
 *   - Rayon (various sizes)
 *   - Cotton quilting thread
 *   - Serger / bobbin / specialty threads
 *
 * Ink/Stitch bundles a `threadart.gpl` palette so authoritative hex lookup
 * works for the core catalog. Image-sampling fills in anything missing.
 */

const API_URL = "https://www.threadart.com/products.json";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

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
  price: string;
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
  options: unknown[];
};

type ApiResponse = { products: ApiProduct[] };

// ─── Curated output shapes ───────────────────────────────────────────────

type CuratedImage = {
  src: string;
  width: number | null;
  height: number | null;
};

export type ThreadartItem = {
  // Identity
  sku: string | null;
  handle: string;
  title: string;
  variant_title: string;
  online_store_url: string;

  // Categorization
  product_type: string | null;
  tags: string[];

  // Copy
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

  // Pricing
  price?: number;
  compare_at_price?: number;

  // Availability — Shopify Storefront exposes boolean only.
  available: boolean;

  // Physical
  grams: number | null;
};

export type ThreadartPullResult = {
  source: "threadart";
  fetchedAt: string;
  endpoints: { api: string };
  itemsTotal: number;
  items: ThreadartItem[];
};

// ─── Fetch helpers ───────────────────────────────────────────────────────

async function fetchPage(page: number): Promise<{ products: ApiProduct[] }> {
  const url = `${API_URL}?limit=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `threadart products.json fetch failed (page ${page}): ${res.status} ${res.statusText}`,
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

function curateProductVariants(product: ApiProduct): ThreadartItem[] {
  const productImages = product.images.map(curateImage);
  const onlineStoreUrl = `https://www.threadart.com/products/${product.handle}`;

  return product.variants.map((variant) => {
    const image = variant.featured_image ?? product.images[0];
    const price = toMoney(variant.price);
    const compareAt = toMoney(variant.compare_at_price);

    const item: ThreadartItem = {
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

export async function pullThreadart(): Promise<ThreadartPullResult> {
  const items: ThreadartItem[] = [];
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
      `[threadart-pull] hit MAX_PAGES=${MAX_PAGES} cap — catalog may be truncated`,
    );
  }

  return {
    source: "threadart",
    fetchedAt: new Date().toISOString(),
    endpoints: { api: API_URL },
    itemsTotal: items.length,
    items,
  };
}

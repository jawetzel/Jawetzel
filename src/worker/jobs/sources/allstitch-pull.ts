/**
 * AllStitch — vendor inventory pull.
 *
 * Two-step: (1) scrape `window.lbupsellToken = "…"` (Shopify Storefront
 * access token) from the landing page; (2) POST to Shopify's Storefront
 * GraphQL with that token in `x-shopify-storefront-access-token`. Paginates
 * 250 products per page via cursor until `hasNextPage: false`.
 *
 * Shape note: AllStitch is a Shopify store, so products have a nested
 * variants list and each variant has its own SKU / price / stock. To match
 * the other vendors' "one row per SKU" model, we emit one curated item per
 * variant. Product-level fields (title, description, tags, collections,
 * featured image, etc.) are inherited onto each variant row.
 *
 * Cost fields: Shopify Storefront only exposes consumer-facing pricing —
 * no dealer/cost fields available on this API surface.
 */

const PAGE_URL = "https://allstitch.com/";
const API_URL = "https://allstitch.com/api/2025-07/graphql.json";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

// Shopify does cost-based rate limiting on Storefront queries. 3s spacing
// matches the Sulky vendor and keeps us well under throttle thresholds.
const PAGE_DELAY_MS = 3000;
const MAX_PAGES = 500;

const QUERY = `query getProducts($cursor:String){products(first:250,after:$cursor,sortKey:ID){edges{cursor node{id handle title description descriptionHtml productType vendor tags createdAt updatedAt publishedAt availableForSale isGiftCard requiresSellingPlan onlineStoreUrl totalInventory seo{title description} featuredImage{id url altText width height} images(first:20){edges{node{id url altText width height}}} priceRange{minVariantPrice{amount currencyCode}maxVariantPrice{amount currencyCode}} compareAtPriceRange{minVariantPrice{amount currencyCode}maxVariantPrice{amount currencyCode}} options{id name optionValues{id name}} variants(first:100){edges{node{id title sku barcode availableForSale currentlyNotInStock quantityAvailable weight weightUnit taxable requiresShipping selectedOptions{name value} image{id url altText width height} price{amount currencyCode} compareAtPrice{amount currencyCode} unitPrice{amount currencyCode}}}} collections(first:25){edges{node{id handle title}}}}} pageInfo{hasNextPage endCursor}}}`;

// ─── API shapes ───────────────────────────────────────────────────────────

type Money = { amount: string; currencyCode: string };

type ApiImage = {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
};

type ApiOptionValue = { id: string; name: string };

type ApiOption = {
  id: string;
  name: string;
  optionValues: ApiOptionValue[];
};

type ApiVariant = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  currentlyNotInStock: boolean;
  quantityAvailable: number | null;
  weight: number | null;
  weightUnit: string | null;
  taxable: boolean;
  requiresShipping: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  image: ApiImage | null;
  price: Money | null;
  compareAtPrice: Money | null;
  unitPrice: Money | null;
};

type ApiCollection = { id: string; handle: string; title: string };

type ApiProduct = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  availableForSale: boolean;
  isGiftCard: boolean;
  requiresSellingPlan: boolean;
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  seo: { title: string | null; description: string | null } | null;
  featuredImage: ApiImage | null;
  images: { edges: Array<{ node: ApiImage }> };
  priceRange: {
    minVariantPrice: Money;
    maxVariantPrice: Money;
  };
  compareAtPriceRange: {
    minVariantPrice: Money;
    maxVariantPrice: Money;
  };
  options: ApiOption[];
  variants: { edges: Array<{ node: ApiVariant }> };
  collections: { edges: Array<{ node: ApiCollection }> };
};

type ApiResponse = {
  data?: {
    products: {
      edges: Array<{ cursor: string; node: ApiProduct }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  errors?: Array<{ message: string }>;
};

// ─── Curated output shapes ───────────────────────────────────────────────

type CuratedImage = {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
};

type CuratedOption = { name: string; values: string[] };

type CuratedCollection = { handle: string; title: string };

type CuratedSelectedOption = { name: string; value: string };

export type AllStitchItem = {
  // Identity
  sku: string | null;
  handle: string;
  online_store_url: string | null;
  title: string; // product title
  variant_title: string; // e.g. "Default Title" or "Large / Red"
  barcode: string | null;

  // Categorization
  product_type: string | null;
  vendor_name: string | null;
  tags: string[];
  collections: CuratedCollection[];

  // Copy / SEO
  description: string | null;
  description_html: string | null;
  seo_title: string | null;
  seo_description: string | null;

  // Dates
  created_at: string;
  updated_at: string;
  published_at: string | null;

  // Image — variant's own if present, else product's featured image
  image_url?: string;
  image_alt_text?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  // Full gallery (product-level)
  product_images: CuratedImage[];

  // Pricing (variant-level)
  price?: number;
  currency_code?: string;
  compare_at_price?: number;
  unit_price?: number;

  // Availability / fulfillment (variant-level)
  available_for_sale: boolean;
  currently_not_in_stock: boolean;
  quantity_available: number | null;
  total_inventory: number | null;
  is_gift_card: boolean;
  requires_selling_plan: boolean;
  taxable: boolean;
  requires_shipping: boolean;
  weight: number | null;
  weight_unit: string | null;

  // Options (variant-level selections + product-level definitions)
  selected_options: CuratedSelectedOption[];
  product_options: CuratedOption[];
};

export type AllStitchPullResult = {
  source: "allstitch";
  fetchedAt: string;
  endpoints: { page: string; api: string };
  itemsTotal: number;
  items: AllStitchItem[];
};

// ─── Fetch helpers ───────────────────────────────────────────────────────

async function fetchAccessToken(): Promise<string> {
  const res = await fetch(PAGE_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(
      `allstitch page fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const html = await res.text();

  const match = html.match(/window\.lbupsellToken\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("allstitch: window.lbupsellToken not found on page");
  return match[1];
}

async function fetchPage(
  token: string,
  cursor: string | null,
): Promise<{
  products: ApiProduct[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-shopify-storefront-access-token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ query: QUERY, variables: { cursor } }),
  });
  if (!res.ok) {
    throw new Error(
      `allstitch graphql fetch failed: ${res.status} ${res.statusText}`,
    );
  }

  const payload = (await res.json()) as ApiResponse;
  if (payload.errors?.length) {
    const msg = payload.errors.map((e) => e.message).join("; ");
    throw new Error(`allstitch graphql errors: ${msg}`);
  }
  if (!payload.data) {
    throw new Error("allstitch graphql: missing data");
  }

  const products = payload.data.products;
  return {
    products: products.edges.map((e) => e.node),
    hasNextPage: products.pageInfo.hasNextPage,
    endCursor: products.pageInfo.endCursor,
  };
}

// ─── Curation ────────────────────────────────────────────────────────────

function toNumber(m: Money | null): number | undefined {
  if (!m) return undefined;
  const n = Number(m.amount);
  return Number.isFinite(n) ? n : undefined;
}

function curateImage(img: ApiImage): CuratedImage {
  return {
    url: img.url,
    altText: img.altText,
    width: img.width,
    height: img.height,
  };
}

function curateProductVariants(product: ApiProduct): AllStitchItem[] {
  const productImages = product.images.edges.map((e) => curateImage(e.node));
  const productOptions: CuratedOption[] = product.options.map((o) => ({
    name: o.name,
    values: o.optionValues.map((v) => v.name),
  }));
  const collections: CuratedCollection[] = product.collections.edges.map((e) => ({
    handle: e.node.handle,
    title: e.node.title,
  }));

  return product.variants.edges.map(({ node: variant }) => {
    const image = variant.image ?? product.featuredImage;
    const price = toNumber(variant.price);
    const compareAt = toNumber(variant.compareAtPrice);
    const unit = toNumber(variant.unitPrice);

    const item: AllStitchItem = {
      sku: variant.sku,
      handle: product.handle,
      online_store_url: product.onlineStoreUrl,
      title: product.title,
      variant_title: variant.title,
      barcode: variant.barcode,

      product_type: product.productType,
      vendor_name: product.vendor,
      tags: product.tags,
      collections,

      description: product.description,
      description_html: product.descriptionHtml,
      seo_title: product.seo?.title ?? null,
      seo_description: product.seo?.description ?? null,

      created_at: product.createdAt,
      updated_at: product.updatedAt,
      published_at: product.publishedAt,

      product_images: productImages,

      available_for_sale: variant.availableForSale,
      currently_not_in_stock: variant.currentlyNotInStock,
      quantity_available: variant.quantityAvailable,
      total_inventory: product.totalInventory,
      is_gift_card: product.isGiftCard,
      requires_selling_plan: product.requiresSellingPlan,
      taxable: variant.taxable,
      requires_shipping: variant.requiresShipping,
      weight: variant.weight,
      weight_unit: variant.weightUnit,

      selected_options: variant.selectedOptions,
      product_options: productOptions,
    };

    if (image) {
      item.image_url = image.url;
      item.image_alt_text = image.altText;
      item.image_width = image.width;
      item.image_height = image.height;
    }

    if (price !== undefined) {
      item.price = price;
      item.currency_code = variant.price?.currencyCode;
    }
    if (compareAt !== undefined) item.compare_at_price = compareAt;
    if (unit !== undefined) item.unit_price = unit;

    return item;
  });
}

// ─── Public entrypoint ───────────────────────────────────────────────────

export async function pullAllstitch(): Promise<AllStitchPullResult> {
  const token = await fetchAccessToken();

  const items: AllStitchItem[] = [];
  let cursor: string | null = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const { products, hasNextPage, endCursor } = await fetchPage(token, cursor);
    for (const product of products) {
      for (const row of curateProductVariants(product)) items.push(row);
    }
    pages += 1;

    if (!hasNextPage || !endCursor) break;
    cursor = endCursor;

    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  if (pages >= MAX_PAGES) {
    console.warn(
      `[allstitch-pull] hit MAX_PAGES=${MAX_PAGES} cap — catalog may be truncated`,
    );
  }

  return {
    source: "allstitch",
    fetchedAt: new Date().toISOString(),
    endpoints: { page: PAGE_URL, api: API_URL },
    itemsTotal: items.length,
    items,
  };
}

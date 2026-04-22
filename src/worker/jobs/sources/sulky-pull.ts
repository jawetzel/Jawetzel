/**
 * Sulky — vendor inventory pull.
 *
 * Two-step: (1) scrape `window.token = "…"` (JWT) from a public product
 * landing page; (2) walk BigCommerce's Storefront GraphQL with that bearer,
 * paginating 50 products per page via cursor until `hasNextPage: false`.
 *
 * We don't archive Sulky's raw response. Top-level fields are flattened
 * (brand.name → brand_name, defaultImage.urlOriginal → image_url, etc.) and
 * the `customFields` key/value array is filtered down to an allowlist
 * (`KEEP_CUSTOM_FIELDS`) before we return.
 *
 * Cost fields: BigCommerce Storefront exposes prices only — admin-API cost
 * fields (average/last/standard) aren't available to storefront tokens.
 */

const PAGE_URL = "https://sulky.com/thread/cotton/";
const API_URL = "https://sulky.com/graphql";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

// Inter-page delay to stay polite on a public endpoint. A ~3k-product
// catalog at 50/page is ~60 requests, so 3s between = ~3 minutes per run.
const PAGE_DELAY_MS = 3000;

// Safety cap so a bug in `hasNextPage` can't run the worker in a loop forever.
const MAX_PAGES = 500;

const QUERY = `query GetProducts($after: String) { site { products(first: 50, after: $after) { pageInfo { hasNextPage endCursor } edges { node { entityId sku name path brand { name } defaultImage { urlOriginal altText } prices { price { value currencyCode } salePrice { value currencyCode } retailPrice { value currencyCode } } availabilityV2 { status } inventory { isInStock aggregated { availableToSell } hasVariantInventory } customFields(first: 50) { edges { node { name value } } } variants(first: 50) { edges { node { sku isPurchasable inventory { isInStock aggregated { availableToSell } } } } } } } } } }`;

const KEEP_CUSTOM_FIELDS = new Set<string>([
  // Quantity / dimensions
  "yardage",
  "num_items_in_assort",
  "width",
  "depth",
  "height",
  "product_dimensions",
  // Thread / spool attrs
  "thread_weight",
  "fiber_content",
  "spool_or_cone",
  "spool_type",
  "hand_weight",
  "solid_variegated_and_multi",
  "specialty",
  "designer",
  "enka_certified",
  // Color
  "color_name",
  "color_number",
  "color_family_1",
  "color_family_2",
  "color_family_3",
  "color_family_4",
  // Product-type-specific
  "recommended_needle_1",
  "recommended_needle_2",
  "needle_style",
  "needle_type",
  "needle_point",
  "backing_or_topping",
  "permanent_or_temporary",
  "removal_method",
  // Use & flags
  "usage",
  "usage_2",
  "usage_3",
  "usage_4",
  "wheels",
  "fold_away",
  "grip_left_handed",
  "view_online",
]);

// ─── API shapes ───────────────────────────────────────────────────────────

type ApiPrice = { value: number; currencyCode: string };

type ApiCustomField = { name: string; value: string };

type ApiVariant = {
  sku: string;
  isPurchasable: boolean;
  inventory: {
    isInStock: boolean;
    aggregated: { availableToSell: number } | null;
  };
};

type ApiProduct = {
  entityId: number;
  sku: string;
  name: string;
  path: string;
  brand: { name: string } | null;
  defaultImage: { urlOriginal: string; altText: string } | null;
  prices: {
    price: ApiPrice | null;
    salePrice: ApiPrice | null;
    retailPrice: ApiPrice | null;
  } | null;
  availabilityV2: { status: string };
  inventory: {
    isInStock: boolean;
    aggregated: { availableToSell: number } | null;
    hasVariantInventory: boolean;
  };
  customFields: { edges: Array<{ node: ApiCustomField }> };
  variants: { edges: Array<{ node: ApiVariant }> };
};

type ApiResponse = {
  data?: {
    site: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: ApiProduct }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
};

// ─── Curated output shapes ───────────────────────────────────────────────

export type SulkyVariant = {
  sku: string;
  is_purchasable: boolean;
  is_in_stock: boolean;
  available_to_sell: number | null;
};

export type SulkyItem = {
  sku: string;
  name: string;
  path: string;
  brand_name?: string;
  image_url?: string;
  image_alt_text?: string;
  price?: number;
  sale_price?: number;
  retail_price?: number;
  currency_code?: string;
  availability_status?: string;
  is_in_stock?: boolean;
  available_to_sell?: number | null;
  has_variant_inventory?: boolean;
  variants?: SulkyVariant[];
  // Custom fields (source values are always string; preserve as-is)
  yardage?: string;
  num_items_in_assort?: string;
  width?: string;
  depth?: string;
  height?: string;
  product_dimensions?: string;
  thread_weight?: string;
  fiber_content?: string;
  spool_or_cone?: string;
  spool_type?: string;
  hand_weight?: string;
  solid_variegated_and_multi?: string;
  specialty?: string;
  designer?: string;
  enka_certified?: string;
  color_name?: string;
  color_number?: string;
  color_family_1?: string;
  color_family_2?: string;
  color_family_3?: string;
  color_family_4?: string;
  recommended_needle_1?: string;
  recommended_needle_2?: string;
  needle_style?: string;
  needle_type?: string;
  needle_point?: string;
  backing_or_topping?: string;
  permanent_or_temporary?: string;
  removal_method?: string;
  usage?: string;
  usage_2?: string;
  usage_3?: string;
  usage_4?: string;
  wheels?: string;
  fold_away?: string;
  grip_left_handed?: string;
  view_online?: string;
};

export type SulkyPullResult = {
  source: "sulky";
  fetchedAt: string;
  endpoints: { page: string; api: string };
  itemsTotal: number;
  items: SulkyItem[];
};

// ─── Fetch helpers ───────────────────────────────────────────────────────

async function fetchAccessToken(): Promise<string> {
  const res = await fetch(PAGE_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`sulky page fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const match = html.match(/window\.token\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("sulky: window.token not found on page");
  return match[1];
}

async function fetchPage(
  token: string,
  after: string | null,
): Promise<{
  items: ApiProduct[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ query: QUERY, variables: { after } }),
  });
  if (!res.ok) {
    throw new Error(
      `sulky graphql fetch failed: ${res.status} ${res.statusText}`,
    );
  }

  const payload = (await res.json()) as ApiResponse;
  if (payload.errors?.length) {
    const msg = payload.errors.map((e) => e.message).join("; ");
    throw new Error(`sulky graphql errors: ${msg}`);
  }
  if (!payload.data) {
    throw new Error("sulky graphql: missing data");
  }

  const products = payload.data.site.products;
  return {
    items: products.edges.map((e) => e.node),
    hasNextPage: products.pageInfo.hasNextPage,
    endCursor: products.pageInfo.endCursor,
  };
}

// ─── Curation ────────────────────────────────────────────────────────────

function curateItem(product: ApiProduct): SulkyItem {
  const item: SulkyItem = {
    sku: product.sku,
    name: product.name,
    path: product.path,
  };

  if (product.brand?.name) item.brand_name = product.brand.name;

  if (product.defaultImage) {
    if (product.defaultImage.urlOriginal)
      item.image_url = product.defaultImage.urlOriginal;
    if (product.defaultImage.altText)
      item.image_alt_text = product.defaultImage.altText;
  }

  if (product.prices) {
    if (product.prices.price) {
      item.price = product.prices.price.value;
      item.currency_code = product.prices.price.currencyCode;
    }
    if (product.prices.salePrice) item.sale_price = product.prices.salePrice.value;
    if (product.prices.retailPrice)
      item.retail_price = product.prices.retailPrice.value;
  }

  item.availability_status = product.availabilityV2.status;
  item.is_in_stock = product.inventory.isInStock;
  item.available_to_sell = product.inventory.aggregated?.availableToSell ?? null;
  item.has_variant_inventory = product.inventory.hasVariantInventory;

  if (product.variants.edges.length > 0) {
    item.variants = product.variants.edges.map((edge) => ({
      sku: edge.node.sku,
      is_purchasable: edge.node.isPurchasable,
      is_in_stock: edge.node.inventory.isInStock,
      available_to_sell: edge.node.inventory.aggregated?.availableToSell ?? null,
    }));
  }

  for (const edge of product.customFields.edges) {
    const { name, value } = edge.node;
    if (KEEP_CUSTOM_FIELDS.has(name)) {
      (item as Record<string, unknown>)[name] = value;
    }
  }

  return item;
}

// ─── Public entrypoint ───────────────────────────────────────────────────

export async function pullSulky(): Promise<SulkyPullResult> {
  const token = await fetchAccessToken();

  const items: SulkyItem[] = [];
  let after: string | null = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const { items: raw, hasNextPage, endCursor } = await fetchPage(token, after);
    for (const product of raw) items.push(curateItem(product));
    pages += 1;

    if (!hasNextPage || !endCursor) break;
    after = endCursor;

    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  if (pages >= MAX_PAGES) {
    console.warn(
      `[sulky-pull] hit MAX_PAGES=${MAX_PAGES} cap — catalog may be truncated`,
    );
  }

  return {
    source: "sulky",
    fetchedAt: new Date().toISOString(),
    endpoints: { page: PAGE_URL, api: API_URL },
    itemsTotal: items.length,
    items,
  };
}

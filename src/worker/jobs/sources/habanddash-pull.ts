/**
 * Hab+Dash (by Fil-Tec) — vendor inventory pull.
 *
 * Platform: Magento 2 (Shero Commerce theme, Magento_Company B2B module).
 * Endpoint: `POST https://www.habanddash.com/graphql` — public, no auth needed
 * to *query*, but B2B customer-group pricing means **all price fields return
 * null for anonymous sessions**. The query below captures them anyway so the
 * output shape is stable; once auth lands, the same curation just populates.
 *
 * TODO: run authenticated to populate prices.
 *   1. Register (or use) a dealer account at habanddash.com.
 *   2. Stash creds in env: HABANDDASH_EMAIL, HABANDDASH_PASSWORD.
 *   3. Before paginating, call `generateCustomerToken(email, password)` mutation
 *      and add `Authorization: Bearer <token>` to every subsequent request.
 *   4. Token lives ~1h by default — fine for one catalog walk, re-mint per run.
 *
 * Pagination: cursor-less, `pageSize` + `currentPage`. Catalog size ~2,169.
 * 3s inter-page spacing matches the other vendors.
 */

const API_URL = "https://www.habanddash.com/graphql";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

// 100/page against ~2,169 products = ~22 requests = ~66s + fetch time at 3s spacing.
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 3000;
const MAX_PAGES = 100;

const QUERY = `query GetProducts($page:Int!,$pageSize:Int!){products(search:"",pageSize:$pageSize,currentPage:$page,sort:{position:ASC}){total_count page_info{total_pages current_page page_size}items{__typename uid sku name url_key url_suffix meta_title meta_description meta_keyword new_from_date new_to_date only_x_left_in_stock rating_summary review_count stock_status swatch_image description{html}image{url label}small_image{url}thumbnail{url}media_gallery{url label position disabled}categories{name url_path level}price_range{minimum_price{regular_price{value currency}final_price{value currency}discount{amount_off percent_off}}}price_tiers{quantity final_price{value currency}discount{amount_off percent_off}}special_price special_to_date url_rewrites{parameters{name value}}... on PhysicalProductInterface{weight}}}}`;

const LOGIN_MUTATION = `mutation Login($email:String!,$password:String!){generateCustomerToken(email:$email,password:$password){token}}`;

// ─── API shapes ───────────────────────────────────────────────────────────

type ApiMoney = { value: number | null; currency: string | null };

type ApiImage = {
  url: string | null;
  label?: string | null;
  position?: number | null;
  disabled?: boolean | null;
};

type ApiCategory = {
  name: string;
  url_path: string;
  level: number;
};

type ApiDiscount = {
  amount_off: number | null;
  percent_off: number | null;
} | null;

type ApiTierPrice = {
  quantity: number;
  final_price: ApiMoney;
  discount: ApiDiscount;
};

type ApiUrlRewrite = {
  parameters: Array<{ name: string; value: string }>;
};

type ApiProduct = {
  __typename: string;
  uid: string;
  sku: string;
  name: string;
  url_key: string;
  url_suffix: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_keyword: string | null;
  new_from_date: string | null;
  new_to_date: string | null;
  only_x_left_in_stock: number | null;
  rating_summary: number;
  review_count: number;
  stock_status: string | null;
  swatch_image: string | null;
  description: { html: string } | null;
  image: ApiImage | null;
  small_image: ApiImage | null;
  thumbnail: ApiImage | null;
  media_gallery: ApiImage[];
  categories: ApiCategory[];
  price_range: {
    minimum_price: {
      regular_price: ApiMoney;
      final_price: ApiMoney;
      discount: ApiDiscount;
    };
  };
  price_tiers: ApiTierPrice[];
  special_price: number | null;
  special_to_date: string | null;
  url_rewrites: ApiUrlRewrite[];
  weight?: number | null;
};

type ApiResponse = {
  data?: {
    products: {
      total_count: number;
      page_info: { total_pages: number; current_page: number; page_size: number };
      items: ApiProduct[];
    };
  };
  errors?: Array<{ message: string; path?: Array<string | number> }>;
};

// ─── Curated output shapes ───────────────────────────────────────────────

type CuratedMedia = {
  url: string;
  label: string | null;
  position: number | null;
};

type CuratedCategory = { name: string; url_path: string; level: number };

type CuratedTier = {
  quantity: number;
  final_price: number | null;
  currency: string | null;
  discount_percent_off: number | null;
};

export type HabanddashItem = {
  // Identity
  sku: string;
  name: string;
  uid: string;
  url_key: string;
  url_suffix: string | null;
  internal_id: string | null;
  __typename: string;

  // Categorization
  categories: CuratedCategory[];

  // Copy / SEO
  description_html: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_keyword: string | null;

  // Dates
  new_from_date: string | null;
  new_to_date: string | null;

  // Images
  image_url: string | null;
  small_image_url: string | null;
  thumbnail_url: string | null;
  swatch_image: string | null;
  media_gallery: CuratedMedia[];

  // Availability
  stock_status: string | null;
  only_x_left_in_stock: number | null;
  rating_summary: number;
  review_count: number;

  // Pricing — NULL FOR ANONYMOUS SESSIONS (Magento B2B gating).
  // TODO: run authenticated (see header comment) to populate these.
  regular_price: number | null;
  regular_price_currency: string | null;
  final_price: number | null;
  final_price_currency: string | null;
  discount_amount_off: number | null;
  discount_percent_off: number | null;
  special_price: number | null;
  special_to_date: string | null;
  price_tiers: CuratedTier[];

  // Physical (undefined on VirtualProduct/DownloadableProduct)
  weight: number | null;
};

export type HabanddashPullResult = {
  source: "habanddash";
  fetchedAt: string;
  endpoints: { api: string };
  authenticated: boolean;
  itemsTotal: number;
  items: HabanddashItem[];
};

// ─── Fetch helpers ───────────────────────────────────────────────────────

/**
 * Mint a customer token if creds are in env. Returns null (→ anonymous run)
 * when either var is missing. Throws if creds are set but Magento rejects
 * them — we'd rather fail loud than silently downgrade to null prices.
 */
async function fetchAccessToken(): Promise<string | null> {
  const email = process.env.HABANDDASH_EMAIL;
  const password = process.env.HABANDDASH_PASSWORD;
  if (!email || !password) {
    console.log(
      "[habanddash-pull] HABANDDASH_EMAIL/PASSWORD not set — running anonymous (prices will be null)",
    );
    return null;
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      query: LOGIN_MUTATION,
      variables: { email, password },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `habanddash login failed: ${res.status} ${res.statusText}`,
    );
  }

  const payload = (await res.json()) as {
    data?: { generateCustomerToken: { token: string } | null };
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length) {
    const msg = payload.errors.map((e) => e.message).join("; ");
    throw new Error(`habanddash login errors: ${msg}`);
  }
  const token = payload.data?.generateCustomerToken?.token;
  if (!token) throw new Error("habanddash login: no token in response");

  console.log("[habanddash-pull] authenticated — prices should populate");
  return token;
}

async function fetchPage(
  page: number,
  token: string | null,
): Promise<{
  products: ApiProduct[];
  totalPages: number;
  totalCount: number;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: QUERY,
      variables: { page, pageSize: PAGE_SIZE },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `habanddash graphql fetch failed: ${res.status} ${res.statusText}`,
    );
  }

  const payload = (await res.json()) as ApiResponse;
  if (payload.errors?.length) {
    const msg = payload.errors.map((e) => e.message).join("; ");
    throw new Error(`habanddash graphql errors: ${msg}`);
  }
  if (!payload.data) {
    throw new Error("habanddash graphql: missing data");
  }

  return {
    products: payload.data.products.items,
    totalPages: payload.data.products.page_info.total_pages,
    totalCount: payload.data.products.total_count,
  };
}

// ─── Curation ────────────────────────────────────────────────────────────

function extractInternalId(rewrites: ApiUrlRewrite[]): string | null {
  for (const rw of rewrites) {
    for (const param of rw.parameters) {
      if (param.name === "id") return param.value;
    }
  }
  return null;
}

function curateMediaGallery(gallery: ApiImage[]): CuratedMedia[] {
  return gallery
    .filter((g) => g.url)
    .map((g) => ({
      url: g.url as string,
      label: g.label ?? null,
      position: g.position ?? null,
    }));
}

function curateTiers(tiers: ApiTierPrice[]): CuratedTier[] {
  return tiers.map((t) => ({
    quantity: t.quantity,
    final_price: t.final_price?.value ?? null,
    currency: t.final_price?.currency ?? null,
    discount_percent_off: t.discount?.percent_off ?? null,
  }));
}

function curateItem(p: ApiProduct): HabanddashItem {
  const minPrice = p.price_range?.minimum_price;
  return {
    sku: p.sku,
    name: p.name,
    uid: p.uid,
    url_key: p.url_key,
    url_suffix: p.url_suffix,
    internal_id: extractInternalId(p.url_rewrites ?? []),
    __typename: p.__typename,

    categories: (p.categories ?? []).map((c) => ({
      name: c.name,
      url_path: c.url_path,
      level: c.level,
    })),

    description_html: p.description?.html ?? null,
    meta_title: p.meta_title,
    meta_description: p.meta_description,
    meta_keyword: p.meta_keyword,

    new_from_date: p.new_from_date,
    new_to_date: p.new_to_date,

    image_url: p.image?.url ?? null,
    small_image_url: p.small_image?.url ?? null,
    thumbnail_url: p.thumbnail?.url ?? null,
    swatch_image: p.swatch_image,
    media_gallery: curateMediaGallery(p.media_gallery ?? []),

    stock_status: p.stock_status,
    only_x_left_in_stock: p.only_x_left_in_stock,
    rating_summary: p.rating_summary,
    review_count: p.review_count,

    regular_price: minPrice?.regular_price?.value ?? null,
    regular_price_currency: minPrice?.regular_price?.currency ?? null,
    final_price: minPrice?.final_price?.value ?? null,
    final_price_currency: minPrice?.final_price?.currency ?? null,
    discount_amount_off: minPrice?.discount?.amount_off ?? null,
    discount_percent_off: minPrice?.discount?.percent_off ?? null,
    special_price: p.special_price,
    special_to_date: p.special_to_date,
    price_tiers: curateTiers(p.price_tiers ?? []),

    weight: p.weight ?? null,
  };
}

// ─── Public entrypoint ───────────────────────────────────────────────────

export async function pullHabanddash(): Promise<HabanddashPullResult> {
  const token = await fetchAccessToken();

  const items: HabanddashItem[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const { products, totalPages: tp } = await fetchPage(page, token);
    for (const product of products) items.push(curateItem(product));
    totalPages = tp;
    page += 1;

    if (page <= totalPages && page <= MAX_PAGES) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(
      `[habanddash-pull] hit MAX_PAGES=${MAX_PAGES} cap — catalog may be truncated`,
    );
  }

  return {
    source: "habanddash",
    fetchedAt: new Date().toISOString(),
    endpoints: { api: API_URL },
    authenticated: token !== null,
    itemsTotal: items.length,
    items,
  };
}

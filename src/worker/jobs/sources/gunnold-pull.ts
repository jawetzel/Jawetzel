/**
 * Gunnold — vendor inventory pull.
 *
 * Two-step: (1) scrape the product landing page for a short-lived bearer
 * that Gunold's frontend bakes into `var ix_token = { ... }`; (2) hand that
 * bearer to their itemextend search API to pull the full catalog.
 *
 * We don't archive Gunold's raw response. The returned payload is curated
 * down to a fixed allowlist of fields (`KEEP_FIELDS`) — anything Gunold
 * returns outside that list is dropped before we write to R2.
 */

const PAGE_URL = "https://www.gunold.com/mx/polyester-embroidery-thread-40/";
const API_URL =
  "https://gunoldusa.itemextend.com/api/search/?format=json&rc=10000&fs=2&o=_score";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";

// The only fields we keep per item. Anything else Gunold returns is dropped.
const KEEP_FIELDS = [
  "stock_number",
  "product_name",
  "catalog_description",
  "large_url",
  "image_alt_text",
  "item_seo_link",
  "list_price",
  "last_cost",
  "average_cost",
  "standard_cost",
  "unit_of_measure",
  "number_pieces",
  "yardage",
  "active",
  "view_online",
  "manufacturer",
  "brand",
  "category",
  "product_type",
  "fiber_content",
  "thread_weight",
  "color_name",
  "color_number",
  "quantity_available",
  "stock_number_canada",
  "manufacturers_part_number",
  "hoop_size_metric",
  "hoop_size_inches",
  "grip_right_handed",
  "prewound",
  "backlash_spring",
  "available_kit",
  "bi_directional",
] as const;

type KeepField = (typeof KEEP_FIELDS)[number];

export type GunnoldItem = Partial<{
  stock_number: string;
  product_name: string;
  catalog_description: string;
  large_url: string;
  image_alt_text: string;
  item_seo_link: string;
  list_price: number;
  last_cost: number;
  average_cost: number;
  standard_cost: number;
  unit_of_measure: string;
  number_pieces: number;
  yardage: number;
  active: boolean;
  view_online: boolean;
  manufacturer: string;
  brand: string;
  category: string;
  product_type: string;
  fiber_content: string;
  thread_weight: string;
  color_name: string;
  color_number: string;
  quantity_available: number;
  stock_number_canada: string;
  manufacturers_part_number: string;
  hoop_size_metric: string;
  hoop_size_inches: string;
  grip_right_handed: boolean;
  prewound: boolean;
  backlash_spring: boolean;
  available_kit: boolean;
  bi_directional: boolean;
}>;

type GunnoldApiHit = { _source: Record<string, unknown> };

type GunnoldApiResponse = {
  results_total: number;
  results: GunnoldApiHit[];
};

export type GunnoldPullResult = {
  source: "gunnold";
  fetchedAt: string;
  endpoints: { page: string; api: string };
  itemsTotal: number;
  items: GunnoldItem[];
};

function curateItem(source: Record<string, unknown>): GunnoldItem {
  const out: Record<string, unknown> = {};
  for (const field of KEEP_FIELDS as readonly KeepField[]) {
    if (field in source) out[field] = source[field];
  }
  return out as GunnoldItem;
}

async function fetchAccessToken(): Promise<string> {
  const res = await fetch(PAGE_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(
      `gunnold page fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const html = await res.text();

  const block = html.match(/var\s+ix_token\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!block) throw new Error("gunnold: ix_token block not found on page");

  const tokenMatch = block[1].match(/"access_token"\s*:\s*"([^"]+)"/);
  if (!tokenMatch) throw new Error("gunnold: access_token not found in ix_token");

  return tokenMatch[1];
}

export async function pullGunnold(): Promise<GunnoldPullResult> {
  const accessToken = await fetchAccessToken();

  const apiRes = await fetch(API_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!apiRes.ok) {
    throw new Error(
      `gunnold api fetch failed: ${apiRes.status} ${apiRes.statusText}`,
    );
  }
  const payload = (await apiRes.json()) as GunnoldApiResponse;

  return {
    source: "gunnold",
    fetchedAt: new Date().toISOString(),
    endpoints: { page: PAGE_URL, api: API_URL },
    itemsTotal: payload.results_total,
    items: payload.results.map((hit) => curateItem(hit._source)),
  };
}

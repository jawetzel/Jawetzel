/**
 * Madeira USA — vendor inventory pull. **TODO: must scrape HTML.**
 *
 * Unlike the other vendors, Madeira USA has no JSON API we can reach.
 * Full recon (2026-04-22) on https://www.madeirausa.com/polyneon/:
 *   - Platform: custom ASP.NET WebForms on IIS 8.5 (Brave River Solutions).
 *   - Product grid is fully server-rendered; pagination is ASP.NET
 *     `__doPostBack` (requires round-tripping `__VIEWSTATE` / `__EVENTVALIDATION`).
 *   - Only two `.ashx` handlers exist site-wide, neither exposes catalog data:
 *       - /ProductCompareHandler.ashx (4-item compare tray state)
 *       - /_ajax/SearchSuggestions.ashx (XML autocomplete strings)
 *   - No /robots.txt, no /sitemap.xml, no /sitemap_index.xml (all 404).
 *   - Prices are gated behind a dealer login ("Login to view price").
 *
 * Implementation will require:
 *   - HTML scraping (cheerio or similar) over category pages.
 *   - ViewState round-tripping for pagination.
 *   - Optional: authenticated session (cookie jar) if we want prices.
 */

export type MadeiraUsaItem = {
  // TODO: pin down curated shape once we start scraping.
  sku: string;
  name: string;
};

export type MadeiraUsaPullResult = {
  source: "madeirausa";
  fetchedAt: string;
  endpoints: { page: string };
  itemsTotal: number;
  items: MadeiraUsaItem[];
};

export async function pullMadeirausa(): Promise<MadeiraUsaPullResult> {
  throw new Error(
    "pullMadeirausa: not implemented — Madeira USA has no JSON API, HTML scraping required",
  );
}

/**
 * Search endpoint for the embroidery-supplies tool. Three modes, one route:
 *
 *   GET /search                      → { shops: [{ name, color_count }, ...] }
 *   GET /search?shopping_source=X[&brand=Y&q=Z]
 *                                    → { candidates: [<thread>, ...] }
 *                                      Text match on color_name or color_number
 *                                      within the chosen shop (optionally
 *                                      narrowed to a specific product line).
 *   GET /search?hex=#rrggbb[&tol=N&length_yds=L&strict_length=1]
 *                                    → { reference_hex, tolerance,
 *                                        matches: [<thread> + distance, ...] }
 *                                      All records across every shop whose
 *                                      hex is within `tol` (Euclidean RGB
 *                                      distance) of the reference.
 *
 * All the feed-loading and search logic lives in
 * `@/lib/ai/embroidery-supplies/feeds` so the AI assistant can reuse it
 * server-side without going through HTTP. This route is a thin wrapper
 * that handles query-string parsing.
 *
 * Auth: public. Read access to the feed is open so the color-search demo
 * (and the portfolio AI assistant) can surface matches to anonymous
 * visitors. Download-links and refresh endpoints remain authed.
 */

import type { NextRequest } from "next/server";
import {
  findNeighborhood,
  InvalidHexError,
  listShops,
  searchByHex,
  searchInShop,
} from "@/lib/ai/embroidery-supplies/feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const hexParam = searchParams.get("hex");
  const shoppingSource = searchParams.get("shopping_source");

  try {
    // Mode 3 — hex-distance match.
    if (hexParam) {
      const tolParam = searchParams.get("tol");
      const anchorLenParam = searchParams.get("length_yds");
      const strictLenParam = searchParams.get("strict_length");

      const tolerance =
        tolParam && !Number.isNaN(parseFloat(tolParam))
          ? parseFloat(tolParam)
          : undefined;
      const anchorLen =
        anchorLenParam && !Number.isNaN(parseFloat(anchorLenParam))
          ? parseFloat(anchorLenParam)
          : null;
      // Default off — the match view groups results by length bucket so multiple
      // spool sizes are useful to see at once (250 yd spool vs. 5,500 yd jumbo
      // cone at the same color). Callers can opt in with `strict_length=1` to
      // restrict to the anchor's length only.
      const strictLength = strictLenParam === "1";

      const [result, neighborhood] = await Promise.all([
        searchByHex({ hex: hexParam, tolerance, anchorLen, strictLength }),
        findNeighborhood({ hex: hexParam, tolerance }),
      ]);
      return Response.json({ ...result, neighborhood });
    }

    // Mode 1 — shops list (no shopping_source param, no hex param).
    if (!shoppingSource) {
      return Response.json(await listShops());
    }

    // Mode 2 — text search within a shop.
    const result = await searchInShop({
      shopping_source: shoppingSource,
      brand: searchParams.get("brand"),
      q: searchParams.get("q"),
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof InvalidHexError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Feed load failed" },
      { status: 503 },
    );
  }
}

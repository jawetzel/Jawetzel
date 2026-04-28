# Embroidery feed refactor — Product / Listing split

## Goal

Restructure the compiled supplies feeds around a clean Product / Listing split:

- **Product** — one canonical entity per real-world thread (brand × product_line × color_number × length_yds). Holds shared identity + meta. No per-shop data.
- **Listing** — one row per (Product × shopping_source). Holds buy-side data: price, cost, qty, click-through URL.

Side effects:
- Field rename: today's `manufacturer` → `brand`; today's `brand` → `product_line`. Aligns with industry vocabulary (Madeira *is* a brand; Polyneon *is* a line within Madeira).
- New field: `material` (fiber type) on Product.
- Length moves out of the brand string and into the product key.
- Vendor-specific URL recipes (`url_key`, `online_store_url`, `path`, `item_seo_link`) stay worker-internal; `Listing.url` is baked at compile time.
- `vendor` slug (`"habanddash"`, `"gunnold"`) is worker-internal; runtime + UI use `shopping_source` ("Hab+Dash", "Gunold") as the single human/canonical key.
- All R2 file names get a `dev_` prefix when `NODE_ENV === "development"` so dev work doesn't stomp prod data.

## Field rename map

| Today                                 | After                  | Notes |
|---------------------------------------|------------------------|-------|
| `manufacturer`                        | `brand`                | Trivial rename in most extractors |
| `brand`                               | `product_line`         | Trivial rename in most; surgery for ThreadArt + AllStitch |
| `shopping_source`                     | `shopping_source`      | Unchanged — this name was right |
| (none)                                | `material`             | New: `polyester` / `rayon` / `cotton` / `metallic` / `wool` / `monofilament` / `silk` / `unknown` |
| `vendor` (worker-internal)            | `vendor` (worker-only) | Internal slug; never appears in runtime types |

## New data shapes

```ts
type Material =
  | "polyester"
  | "rayon"
  | "cotton"
  | "metallic"
  | "wool"            // includes wool/acrylic blends like Madeira Burmilana
  | "monofilament"    // clear nylon
  | "silk"
  | "unknown";

type Product = {
  product_key: string;          // <brand>|<product_line>|<color_number>|<length_yds>
  brand: string;                // manufacturer ("Madeira", "Fil-Tec", "Sulky", ...)
  product_line: string;         // line within brand ("Polyneon 40", "Glide 40wt", ...)
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number;           // now non-null (in the key) — see "length policy" below
  thread_weight: number | null;
  material: Material;
};

type Listing = {
  product_key: string;          // FK to Product
  shopping_source: string;      // retailer ("AllStitch", "Hab+Dash", ...)
  url: string;                  // direct buy link, baked at compile time
  price: number | null;
  cost: number | null;
  qty: number | null;
};
```

### Length policy

Length is in the product key, so a record without a yardage can't form a valid Product. Today's `hasLength()` filter at `feeds.ts:282` already drops those at the API boundary — under the new shape, the **compile step** drops them instead. Items that arrive without `length_yds` are counted into `unmatchedByVendor` for the vendor that produced them.

### product_key construction

```
product_key = `${brand}|${product_line}|${color_number}|${length_yds}`
```

Example: `Madeira|Polyneon 40|1234|440`

product_line values that mingle weight + length get cleaned at extract time. Today's `"Polyneon 40-440 yd"` → `"Polyneon 40"` with `length_yds: 440`.

## File-by-file changes

### 1. `src/worker/jobs/compile-feeds.ts`

#### Types
- Replace `PricingRow` with `Listing` (drop `manufacturer`/`brand`/`color_number`/`length_yds`/`thread_weight`/`hex` — those live on Product). Keep `vendor` as the worker-internal slug; map to `shopping_source` at output.
- Replace `DetailsEntry` with `Product`. Drop the `vendors: { vendor → detail-blob }` map entirely — vendor-specific detail recipes only run in the URL builder, never persisted.
- `DetailsFeed` → `ProductsFeed`; `PricingFeed` → `ListingsFeed`.

#### Helpers
- Rename `manufacturerFor(vendor, rawBrand)` → `brandFor(vendor, rawProductLine)`. Same logic, renamed parameter.
- Add `materialFor(vendor, rawProductLine)` — same shape as `brandFor`. Per-vendor mapping:
  - `gunnold` → "polyester" (only product line is Poly 40 / PolyFire)
  - `sulky` → match: `/rayon/` → "rayon", `/cotton/` → "cotton", `/poly|polylite|polydeco|filaine/` → "polyester"
  - `habanddash` → "polyester" (Glide / Magna-Glide are both poly)
  - `allstitch` → match: `/polyneon|aerofil|aerolock|aeroflock|aeroquilt|sensa|matt|fire fighter|monofil/` → "polyester", `/rayon/` → "rayon", `/cotona/` → "cotton", `/metallic|supertwist/` → "metallic", `/burmilana/` → "wool", `/monofil/` → "monofilament"
  - `coldesi` → "polyester" (Isacord / Endura / Royal are all 40wt poly)
  - `threadart` → from explicit Fiber tag: `/polyester/i` → "polyester", `/rayon/i` → "rayon", `/cotton/i` → "cotton"
  - Default → "unknown"
- Add `urlForListing(vendor, detail)` — the existing `vendorUrlFor` from `feeds.ts:214` moves here, runs at compile time.

#### Per-extractor surgery (only the non-trivial ones)

**ThreadArt** (`extractThreadart`, currently lines 787-853):
Today: `brand = "ThreadArt Polyester 1000M"` (synthesized from vendor + fiber + size at line 817).
After:
```ts
brand: "ThreadArt"
product_line: `${fiber || "Thread"}${sizeLabel}`.trim()  // "Polyester 1000M"
material: materialFor("threadart", fiber)
```

**AllStitch** (`extractAllstitch`, currently lines 565-607):
Today: `brand = "Polyneon 40-440 yd"` (the Thread Type tag verbatim).
After: split the tag. The pattern is `<line> <weight>-<yards> yd`:
```ts
const tag = "Polyneon 40-440 yd"
// → product_line: "Polyneon 40", length_yds: 440
const m = tag.match(/^(.+?)\s+(\d+)-(\d+)\s*yd$/i);
if (m) {
  product_line = `${m[1]} ${m[2]}`;
  length_yds = parseInt(m[3], 10);
} else {
  product_line = tag;  // fallback for tags that don't match
}
brand = brandFor("allstitch", product_line);
material = materialFor("allstitch", product_line);
```

**ColDesi** (`extractColdesi`, currently lines 705-776):
Today: `brand = "Isacord"`, `manufacturer = "Isacord"`. Same string twice.
After: `brand = "Isacord"`, `product_line = "Isacord 40"` (explicit weight; ColDesi only stocks 40wt for all three lines). Same pattern for Endura ("Endura 40") and Royal ("Royal 40"). All three: `material = "polyester"`.

**Gunold / Sulky / Hab+Dash**:
Trivial rename. Today's `brand` → `product_line` verbatim. Today's `manufacturer` (returned by `manufacturerFor`) → `brand`. Add `materialFor` lookup.

#### Compile body

Replace the dual-pass over `details[k]` and `pricingByTriple` with a clean two-collection build:

```ts
const products = new Map<string, Product>();   // keyed by product_key
const listings: Listing[] = [];
```

Each extractor output produces one Product (insert if new, backfill nullable fields if existing) and one Listing (always appended, one row per (product, shopping_source)).

URL is computed at compile time via `urlForListing(vendor, out.detail)` and stored on the Listing. The raw `detail` blob is not persisted.

Output:
```ts
{
  products: ProductsFeed,    // { source, fetchedAt, keyCount, vendorsIncluded, unmatchedByVendor, items: Record<product_key, Product> }
  listings: ListingsFeed,    // { source, fetchedAt, keyCount, vendorsIncluded, items: Listing[] }
  listingsCsv: string,
}
```

### 2. `src/lib/ai/embroidery-supplies/feeds.ts`

#### Types
- `DetailEntry` → `Product` (re-exported from compile types).
- `PricingRow` → `Listing` (re-exported).
- `PublicResult` keeps roughly the same shape but its `vendors` map is now built from the listings join, not from a per-product vendor-detail map.

```ts
type PublicResult = {
  product_key: string;
  brand: string;
  product_line: string;
  color_number: string;
  color_name: string | null;
  hex: string | null;
  length_yds: number;
  thread_weight: number | null;
  material: Material;
  listings: Record<
    string,                    // shopping_source as the key
    { price: number | null; cost: number | null; qty: number | null; url: string }
  >;
};
```

#### Cache shape
```ts
type FeedCache = {
  loadedAt: number;
  products: Record<string, Product>;                          // by product_key
  listingsByProduct: Map<string, Map<string, Listing>>;       // product_key → shopping_source → listing
};
```

#### `loadFeeds()`
Reads `supplies/products/current.json` + `supplies/listings/current.json` from R2 (with dev_ prefix). Keys change from `<brand>|<color>` to `<brand>|<product_line>|<color>|<length>`.

#### `searchInShop()` / `listShops()`
- `listShops()` enumerates distinct `shopping_source` values from listings (not from products). Color count = number of unique products with a listing on that shopping_source.
- `searchInShop()` filters products by joining through listings on the chosen shopping_source. Brand filter (was `entry.brand !== brand`) becomes `product.product_line !== productLine` since the original "brand" was actually a line.

#### `searchByHex()`
Iterates products, not details. Joins listings at output time. No structural change to the matching logic.

#### `vendorUrlFor()`
Removed. URL is precomputed on the Listing.

### 3. `src/lib/ai/tools/find-thread-color.ts`

Field renames in `ThreadMatchTile`:
- `brand` (was a product line) → `product_line`
- `manufacturer` (was the actual brand) → `brand`
- New: `material`

The tool description text references "brand" and "manufacturer" — update to match the new vocabulary so the LLM doesn't get confused.

### 4. `src/app/api/tools/embroidery-supplies/search/route.ts`

Query-param rename:
- `?brand=X` → `?product_line=X` (filtering within a shop)
- `?shopping_source=X` unchanged

Backward-compat for the old `brand` param: accept it for one release as an alias, log a deprecation warning. Remove after.

### 5. `src/app/tools/embroidery-supplies/_components/SupplyFeedSearch.tsx`

#### Type updates
`Candidate` and `ColorMatch` swap `brand`/`manufacturer` for `brand`/`product_line` and add `material`. The `vendors` map renames to `listings` and is keyed by `shopping_source` (display form) instead of vendor slug.

#### `SHOP_COLUMNS`
Already uses display names ("AllStitch", "ColDesi", ...). With `vendor` slug retired from runtime, this becomes the single canonical column list — no slug-to-display translation anywhere. Can be derived from feed (distinct shopping_sources) instead of hardcoded.

#### `MatchesView` headers
The anchor block at line 451-466 references `anchor.shopping_source · anchor.brand · by anchor.manufacturer`. Update to `anchor.shopping_source · anchor.brand · anchor.product_line` (drop "by" prefix — brand is the manufacturer now).

#### Material chip
Add a small `material` chip near the color swatch in the anchor block and on each pivot row's color header. Helpful disambiguation for cases like Madeira Polyneon vs Rayon at the same color number.

### 6. `src/app/api/tools/embroidery-supplies/download-links/route.ts`

R2 key change:
- `supplies/pricing/current.csv` → `supplies/listings/current.csv`
- Filename in the response: `supplies-pricing-current.csv` → `supplies-listings-current.csv`

Both pass through the dev_ prefix wrapper.

### 7. `src/worker/jobs/refresh-embroidery-supplies.ts`

#### R2 keys (with dev_ wrapping)
- `supplies/details/current.json` → `supplies/products/current.json`
- `supplies/pricing/current.json` → `supplies/listings/current.json`
- `supplies/pricing/current.csv` → `supplies/listings/current.csv`

Per-vendor archive keys (`supplies/<vendor>/current.json`, `supplies/<vendor>/archive/<date>.json`) are unchanged in shape — they hold raw scraper output and aren't part of the rename. They DO get the dev_ prefix.

The `compileFeeds()` call now destructures `{ products, listings, listingsCsv }`.

### 8. `src/lib/r2.ts` — dev_ prefix helper

Add a centralized helper that all callers route through. Whole-key-prefix variant — keeps dev and prod namespaces fully separated as bucket subtrees, easy to mass-delete dev clutter:

```ts
function applyEnvPrefix(key: string): string {
  if (process.env.NODE_ENV !== "development") return key;
  return `dev_${key}`;
}
```

Apply it inside `downloadFromR2`, `uploadToR2`, and `generatePresignedDownloadUrl` so callers don't have to know about it. The presigned-URL filename (separate from the R2 key) does NOT get the prefix — that's the user-facing download name.

Examples (in dev):
- `supplies/products/current.json` → `dev_supplies/products/current.json`
- `supplies/gunnold/archive/2026-04-27.json` → `dev_supplies/gunnold/archive/2026-04-27.json`
- The local-disk dev mirror (`writeLocalDevSnapshot` in refresh-embroidery-supplies.ts:63) doesn't need the prefix — `data/` is already gitignored.

## R2 migration

Cutover plan:

1. **Land code in dev.** Refactor + dev_ prefix wrapper. Deploy.
2. **Refresh in dev.** `POST /api/tools/embroidery-supplies/refresh` → writes new shape to `dev_*` files in R2. Verify the UI works against the dev feeds.
3. **Smoke-test the AI tool** in dev — `find_thread_color` with a few hexes, confirm tile shape.
4. **Cut prod over.** Deploy to prod, run refresh in prod. New shape lands at `supplies/products/...` and `supplies/listings/...`. Old `supplies/details/current.json` and `supplies/pricing/current.json` keys remain in R2 untouched (orphaned, can be deleted manually after verification).
5. **Cleanup.** After ~1 week of stable prod, manually delete the orphaned `details/` and `pricing/current.json` keys in R2.

Per-vendor archive (`supplies/<vendor>/archive/...`) is preserved — those are raw scraper outputs, untouched by this refactor.

## Tests

Currently no tests touch the supplies feed code (verified via grep). Two worth adding alongside this refactor:

1. **`compile-feeds.test.ts`** — feed in synthetic per-vendor pull data (fixtures), assert:
   - product_key construction
   - extractor surgery (ThreadArt split, AllStitch tag parse, ColDesi line names)
   - listings 1:1 with (product × shopping_source)
   - material classification per vendor
   - URL is baked into the listing
2. **`feeds.test.ts`** — small fixture for products + listings, assert:
   - `searchByHex` joins listings correctly
   - `searchInShop` filters by shopping_source via listings
   - `listShops` enumerates from listings, not products

Vitest is already in the stack (Weekend Plant ports). Add fixtures under `src/worker/jobs/__fixtures__/`.

### 9. `scripts/build-thread-color-map.mjs` + `src/data/thread-color-map.json`

The map is keyed `<paletteKey>|<colorNumber>` for palette-backed entries and `<rawBrand>|<colorNumber>` for fallback entries. Under the new vocabulary, the "rawBrand" half corresponds to what's now `product_line`.

Changes:
- **Palette keys** (`gunold-polyester`, `madeira-polyneon`, `isacord-polyester`, etc.) — stable, no change. The palette IDs are independent of our brand/product_line renaming.
- **Raw fallback keys** — the build script's logic for emitting these keys needs to use the new product_line value, not the old conflated brand string. Anywhere the script reads a vendor's raw "brand" field and uses it as the key prefix, switch to "product_line."
- **`paletteKeyFor(vendor, rawBrand)` in compile-feeds.ts** — rename parameter to `rawProductLine` and confirm all the regex patterns (`/polyneon/`, `/glide/`, `/isacord/`) still match — they're substring matches that don't depend on the length suffix, so they should be fine. Test against the cleaned product_line values ("Polyneon 40" vs old "Polyneon 40-440 yd") to confirm.
- **`computePaletteLookup`** — the `rawBrand` parameter and lookup becomes `rawProductLine`.
- **Rebuild the map.** Run `node scripts/build-thread-color-map.mjs` after the script update. Commit the regenerated JSON.

## Out of scope

- product_line normalization (alias table). Deferred until two scrapers actually disagree on a line string for the same physical line.
- Madeira-direct scraper (still TODO at refresh-embroidery-supplies.ts:151). Independent of this refactor.

## Sequencing

Suggested order to keep changes runnable at each step:

1. R2 dev_ prefix helper (`r2.ts`) + verify dev/prod isolation works on the existing feeds (no shape change yet).
2. compile-feeds.ts: types, helpers, per-extractor surgery, new compile body. Rebuilds with new shape; old runtime breaks.
3. feeds.ts: load + search against new shape. Runtime works again.
4. find-thread-color.ts + search route: field renames. AI tool + API back online.
5. SupplyFeedSearch.tsx: type updates + material chip. UI back online.
6. download-links.ts + refresh route filename: trivial.
7. `scripts/build-thread-color-map.mjs` update + map regenerate + commit new JSON.
8. Tests.
9. Dev refresh → verify → prod refresh → cleanup.

Each step is one PR if you want them split, or one PR if you want to land it all at once. The dev_ prefix in step 1 means everything else is safe to iterate on without prod risk.

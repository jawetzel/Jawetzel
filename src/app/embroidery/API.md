# Embroidery API

Endpoints under `/embroidery/api/`. All private.

## Authentication

Every endpoint requires the shared key in `EMBROIDERY_API_KEY` (set in the deploy env). Pass it as either header:

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`

Missing/wrong key → `401`. Server missing the env var → `500` (fail-closed; the API will not serve traffic without a configured key).

---

## `POST /embroidery/api/generate`

Full pipeline: PNG/JPG/WEBP in, embroidery files + SVG artifacts out.

**Request — `multipart/form-data`**

| field | type | required | default | notes |
|---|---|---|---|---|
| `size` | string | yes | — | Hoop size in inches. Must be one of: `4x4`, `5x7`, `6x10`, `8x8`. |
| `image` | file | yes | — | `image/png`, `image/jpeg`, or `image/webp`. |
| `customer_id` | string | no | `0000-0000-0000-0000` | Tenant folder. 1–64 chars; lowercase alphanumeric plus `-`/`_`; must start alphanumeric. Used as the R2 prefix segment (`embroidery/<customer_id>/<hash>_<size>/`). Omit to write to the shared test-user bucket. |
| `colors` | integer | no | `12` | Quantization color count when no palette is used. Clamped to 2–16. Ignored in practice now that palette selection is AI-driven. |
| `manufacturer` | string | no | `madeira-polyneon` | Thread catalog key. See `GET /embroidery/api/palettes`. |
| `thread_numbers` | string | no | *Madeira-only default* | Comma-separated thread catalog numbers the user has on hand. If omitted AND the manufacturer is `madeira-polyneon`, Madeira's own 45-color starter kit (#924-45) is used. For any other manufacturer, `thread_numbers` is required — we don't guess what's essential across other vendors. |

**Response — `200 application/json`**

```json
{
  "key": "embroidery/<customer_id>/<hash>_<size>/",
  "customerId": "0000-0000-0000-0000",
  "hash": "<sha256[:12]>",
  "size": "4x4",
  "colors": 12,
  "artifacts": ["input.png", "palette.json", "traced.svg", "cleaned.svg", "geometry.json", "tagged.svg", "ai-tags.json", "out.zip"],
  "urls": { "<name>": "https://images.jawetzel.com/<key><name>" },
  "localDir": "<absolute path on server>"
}
```

Every artifact is uploaded to R2 and written to `tmp/embroidery/` (fixed project-local path, overwritten every run).

**Errors**

- `400` — missing `size`/`image`, size not in the allowed list, invalid `customer_id`, unsupported image type, invalid `colors`
- `401` — missing/wrong API key
- `429` — all worker slots busy (one 10-minute pipeline in flight per worker, default 4). Response includes a `Retry-After: 60` header. Retry later.
- `500` — AI failure, worker failure, R2 upload failure. Response body is `{"error": "<message>"}`.

**Example**

```bash
curl -X POST http://localhost:3000/embroidery/api/generate \
  -H "X-API-Key: $EMBROIDERY_API_KEY" \
  -F "size=4x4" \
  -F "image=@design.png;type=image/png" \
  -F "manufacturer=madeira-polyneon" \
  -F "thread_numbers=1765,1804,1976,1885,1660"
```

---

## `POST /embroidery/api/convert`

Bypasses tracing. Takes a pre-authored SVG and runs Ink/Stitch to produce embroidery files.

**Request**

- Query param `size` — required. Must be one of: `4x4`, `5x7`, `6x10`, `8x8`. The worker overrides the SVG's root `width`/`height` to the hoop size in inches before running Ink/Stitch; `viewBox` and path coords are left untouched.
- Body — raw SVG bytes with `content-type: image/svg+xml`.

**Response — `200 application/zip`**

Same shape as `out.zip` from `/generate`: `embroidery.{dst,exp,jef,pes,vp3,xxx,bmp,svg}`.

**Errors**

- `400` — missing/invalid `size`, empty body
- `401` — missing/wrong API key
- `429` — worker slots busy; includes `Retry-After: 60`
- `500` — worker failure
- `502` — worker unreachable

**Example**

```bash
curl -X POST "http://localhost:3000/embroidery/api/convert?size=5x7" \
  -H "X-API-Key: $EMBROIDERY_API_KEY" \
  -H "content-type: image/svg+xml" \
  --data-binary @design.svg \
  -o out.zip
```

---

## `GET /embroidery/api/palettes`

List the manufacturer catalogs the server can load.

**Response — `200 application/json`**

```json
{
  "default": "madeira-polyneon",
  "manufacturers": [
    "madeira-polyneon",
    "madeira-rayon",
    "dmc",
    "isacord-polyester",
    "robison-anton-polyester"
  ]
}
```

Adding a new catalog = drop a `.gpl` file in `src/app/embroidery/_lib/inkstitch/palettes/` and add it to `MANUFACTURER_FILES` in `_lib/inkstitch/gpl-palette.ts`.

---

## Default manufacturer and thread set

When `/generate` is called without `manufacturer` or `thread_numbers`:

- **Manufacturer**: `madeira-polyneon` (Madeira Polyneon #60, 349-color catalog).
- **Thread set**: Madeira's own 45-color starter kit, product #924-45 ("Madeira Polyneon #60 Machine Embroidery Thread 45 Color Kit"). This is a manufacturer-curated essentials set, not our opinion.

Source: [madeirausa.com/924-45-madeira-polyneon-60.html](https://www.madeirausa.com/924-45-madeira-polyneon-60.html)

**The 45 default thread numbers** (looked up in the catalog at request time to attach hex + name for the AI):

```
1624  1637  1642  1670  1673  1678  1682  1723  1725  1738
1747  1750  1756  1765  1791  1800  1801  1803  1811  1812
1816  1835  1840  1841  1842  1843  1845  1851  1866  1874
1918  1922  1924  1934  1944  1945  1955  1966  1970  1971
1973  1977  1981  1984  1988
```

The AI sees the full table for each of these 45 threads — `number / hex / rgb / name` — and picks the smallest subset that matches the design's semantic colors.

Using a **different manufacturer** (e.g. `manufacturer=dmc`) without also supplying `thread_numbers` returns a 500 error: we don't ship a curated default for any other catalog and won't pretend to. Callers must specify their available thread numbers.

---

## `GET /embroidery/api/palettes/:manufacturer`

Full thread listing for a catalog. Use this to build a UI where the user picks which spools they own.

**Response — `200 application/json`**

```json
{
  "manufacturer": "madeira-polyneon",
  "count": 349,
  "threads": [
    { "number": "1610", "hex": "#b7c3c5", "name": "Celestial Blue" },
    { "number": "1611", "hex": "#9ea9b1", "name": "Highrise" },
    ...
  ]
}
```

Thread `number` is what you pass back to `/generate` in `thread_numbers`.

**Errors**

- `404` — unknown manufacturer key. Body: `{"error": "Unknown manufacturer palette '...'. Available: ..."}`

---

## Pipeline order (what `generate` does)

1. Upload source image to R2.
2. Load manufacturer palette, filter to `thread_numbers` (or default 75).
3. **AI call #1 — `selectPalette`**: send PNG + available thread table, AI picks the semantic subset.
4. Worker `/trace`: palette-constrained quantize + potrace per color bucket → SVG.
5. Geometry prefilter: drop specks, suggest `fill`/`satin`/`running` per path by width.
6. **AI call #2 — `tagSvg`**: send metadata table + PNG, AI confirms stitch types + overrides Ink/Stitch params.
7. `applyInkstitchAttrs`: inject `inkstitch:*` attrs, snap colors to selected palette.
8. Worker `/convert`: Ink/Stitch → zip of DST/EXP/JEF/PES/VP3/XXX + BMP preview + SVG.
9. Persist all artifacts to R2 and `tmp/embroidery/`.

---

## Artifact reference

Written to both R2 (`embroidery/<customer_id>/<hash>_<size>/`) and `tmp/embroidery/`.

| file | source | purpose |
|---|---|---|
| `input.png` | request body | original upload |
| `palette.json` | AI select | `{manufacturer, available_count, selected: Thread[]}` |
| `traced.svg` | worker `/trace` | raw multi-color vector trace |
| `geometry.json` | geometry prefilter | per-path mm measurements + stitch suggestion |
| `cleaned.svg` | geometry prefilter | `traced.svg` with specks/background removed |
| `tagged.svg` | `applyInkstitchAttrs` | cleaned SVG with `inkstitch:*` attrs + palette-snapped colors |
| `ai-tags.json` | AI tag-svg | per-path stitch-type decisions |
| `out.zip` | worker `/convert` | `embroidery.{dst,exp,jef,pes,vp3,xxx,bmp,svg}` |
| `embroidery.*` | out.zip extracted | individual embroidery files for direct use |

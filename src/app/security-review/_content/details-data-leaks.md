# Data Leaks

Two separate code paths on [company]'s public site were handing out sensitive pricing and inventory data to any anonymous visitor, including competitors, without a login.

---

## Wholesale cost + live inventory leaked through the product pages (HIGH)

When any visitor opened a product page, the server sent back the full record for that product — including wholesale cost, manufacturer-advertised price (MAP), and live inventory count. The visible page showed "COST: N/A" and "RETAIL: N/A" in the product details area, but the underlying data was present in full.

Nine products were sampled across different categories and [manufacturer]s. In every case, the response included:

| Data point | What was exposed |
|---|---|
| Wholesale cost | Present |
| MAP (where enforced) | Present |
| MSRP (where set) | Present |
| Live inventory count | Actual count (not limited) |
| UPC code | Full |
| Manufacturer SKU | Full |

The pattern held for product categories across the catalog (~45,000 products). Product IDs were sequential, meaning a simple script could walk through the entire catalog and collect wholesale cost + live inventory for every item in a single evening.

### Business impact

- **Wholesale cost exposure.** Competitors could see [company]'s exact wholesale pricing across the entire catalog, which is among the most sensitive data in a distribution business.
- **Supply-chain visibility.** Live inventory counts let competitors track stockouts, anticipate re-ups, and price against shortages in real time.
- **Scripting-friendly.** Product IDs were sequential, so walking the catalog required no guesswork and only a few lines of code.

---

## Same data leaked in every search, category, and department page (HIGH)

Every product search page, category page, department page, and [manufacturer] page embedded a JavaScript array in the page itself with ~23 data points per product — visible to any anonymous visitor.

**Per product, the page revealed:**

| Field | Risk |
|---|---|
| Manufacturer-advertised price (MAP) | Competitor pricing intelligence |
| Sale price | Wholesale pricing intelligence |
| Three inventory quantity fields | Supply-chain intelligence |
| MAP-enforced flag | Pricing-restriction visibility |
| UPC codes | Catalog cross-referencing |
| Manufacturer SKUs | Direct [manufacturer] identification |

### Scale

| Page type | Data exposed per page load |
|---|---|
| A single department page (widgets) | ~5,140+ MAP prices |
| Any search result | MAP prices and inventory for the entire result set |
| Category group page | MAP prices, inventory up to ~1,620 units per item |

---

## Catalog enumeration helpers (LOW)
<!-- docx:skip -->

These didn't constitute findings on their own, but they made the above leaks easier to exploit at scale:

- **Sequential product IDs.** A contiguous numeric range made the catalog walkable without any guesswork.
- **Development flags in client-side code.** Build and environment flags were visible to any visitor, including a boolean indicating whether an admin was logged in.
- **Shipping rates hardcoded in page source.** The rates aren't directly sensitive, but the placement fits the same pattern of business logic being pushed to the browser rather than kept on the server.

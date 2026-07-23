# Internal Pages Exposed

Each of the pages below was reachable by anyone on the public internet, with no login and no authentication check. Data on each page loaded automatically the moment the page opened.

---

## Operations dashboard (HIGH)

Live operational data for the entire warehouse, refreshed in real time.

| Metric | What was showing |
|---|---|
| Open order lines | ~3,840 |
| Open invoices | ~1,720 |
| Invoiced lines — today | ~10,450 |
| Invoiced lines — yesterday | ~13,210 |
| Packages shipped (7 days) | ~54,800 |
| Same-day shipping rate | ~77% |

Also visible: real invoice numbers, a hot-replenishment inventory table (~95 rows), and an endpoint that generates invoice PDFs to public storage.

---

## Accounts receivable dashboard (HIGH)

Full dealer receivables visible in the page data. A visible-to-the-eye trick (white text on white background) hid the data from a casual glance, but all of it was present in the underlying page and visible to anyone who right-clicked and chose "inspect."

<!-- docx:skip-block -->
**Dealer accounts — 8 to 30 days past due:**

| Customer | Salesperson | AR rep | Past due | Last payment |
|---|---|---|---|---|
| [customer] | [staff] | [staff] | ~$54,000 | 2024 |
| [customer] | [staff] | [staff] | ~$28,000 | 2024 |
| [customer] | [staff] | [staff] | ~$19,000 | 2024 |

<!-- /docx:skip-block -->

**Dealer accounts — 30+ days past due:**

| Customer | Salesperson | AR rep | Past due | Last payment |
|---|---|---|---|---|
| [customer] | [staff] | [staff] | **~$178,000** | 2024 |
| [customer] | [staff] | [staff] | **~$167,000** | 2020 |
| [customer] | [staff] | [staff] | ~$32,000 | 2024 |

<!-- docx:skip-block -->
**Chain account aging:**

| Chain | Current | 30+ days |
|---|---|---|
| [customer] | ~$176,000 | ~$112,000 |
| [customer] | ~$128,000 | ~$64,000 |
| [customer] | ~$75,000 | ~$41,000 |
<!-- /docx:skip-block -->

---

<!-- pagebreak -->

## Collections + public file storage (HIGH)

From this page, clicking a group, then a customer, then "view statement" causes the site to generate a PDF of that customer's full financial statement and drop it on a **public** file-storage bucket. The URL uses the customer's account number in the filename, so stepping through numbers retrieves every customer's statement.

**Per customer, the page revealed:**

- Business name and account number
- Full physical address
- Email addresses
- Payment history and dates
- Receivables aging (current, 30-, 60-, 90-day balances)
- Assigned salesperson and AR representative

<!-- docx:skip-block -->
**A downloaded sample statement contained:**

- Business: [customer]
- Address: [address]
- Full receivables aging with dollar amounts
<!-- /docx:skip-block -->

---

## Web payment portal (HIGH)

Opening the page automatically loaded ~2,900 customer payment records (roughly 1 megabyte of data). Per record: customer name, payment amount, timestamp, transaction identifier.

Payment receipt URLs also referenced an internal server name — useful information for an attacker mapping the network.

---

## Accounts payable invoices (HIGH)

Opening the page automatically loaded:

- ~410 **vendor records** — the complete list of companies [company] buys from
- ~8,500 **invoice headers** — purchase order numbers, vendor names, invoice dates, status

For a competitor, this is the complete purchasing relationship map: who the vendors are, how often orders go in, and with what cadence.

---

## Phone dashboard (MEDIUM)

Every employee on the phone system, by full name, with:

- Direct extension
- Real-time call availability (are they on a call right now?)
- Call volume metrics

<!-- docx:skip-block -->
A targeted social-engineering attack ("Hi, is [staff] there? I'll try extension [ext] directly, thanks") becomes easy to stage. The attacker can pick who to impersonate, find the right extension to call, and check whether the person they're impersonating is busy at the time of the call.
<!-- /docx:skip-block -->

---

## Sales queue (MEDIUM)

Real-time sales call data for named employees, auto-refreshing every 7 seconds. Visible per person: completed calls, missed calls, average call duration. Also visible: a rolling sale-items table showing product descriptions and SKUs moving through the sales floor.

---

<!-- pagebreak -->

## Organizational dashboard (MEDIUM)

The warehouse floor, stations, and live headcount.

**Building layout shown:**

- **Building A — Order processing:** picking, packing, quality-control stations
- **Building B — Accessory:** receiving, put-away, returns, and a locked-inventory cage
- **Building C — Regulated inventory:** stations handling hazardous and regulated stock
- **Universal:** general warehouse, management, cleaning, safety, maintenance

**Real-time headcount:** ~84 clocked in / ~62 clocked out at time of review.

The physical-security implication is that a would-be thief can look up where regulated inventory is stored and when the fewest people are on the floor, without any physical reconnaissance.

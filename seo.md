# SEO Data & Analysis Plan

> **Status:** planning document. Nothing here is built yet.
> **Scope:** a standalone, multi-property, vertical-agnostic SEO analysis tool. Designed for ~6 properties from day one, with no assumption that they share a subject, a stack, or an owner.
> **Prices** quoted are DataForSEO rates as of July 2026 (post-July-1 increase) and drift upward — never hardcode them; read the `cost` field off each API response instead.
>
> Worked examples throughout use a gardening content site (`weekendplant.com`). It is an illustration of how the config binds, **not** the subject of this document.

---

## Archetypes

Two kinds of property, with **different objective functions**. This is the deepest fork in the design — deeper than vertical, which is only configuration.

| | **A · Service funnel** | **B · Content** |
|---|---|---|
| Examples | plumbing, hair, roofing, software | cookjunkie, weekendplant, psychable |
| Site's job | Funnel + contact point | Audience + traffic |
| Success metric | Calls, form fills, cost per job | Sessions, impressions, RPM |
| Page count | 15–40 | 50–500+ |
| Geography | **A dimension** | Irrelevant |
| Primary SERP surface | **Local pack + GBP** | Blue links |
| Search volume | Misleading as a priority signal | Central |
| Competitors | Per-city | National |
| AI Overviews | Mild threat | **Existential** |

**Volume is the line that breaks a shared design.** "Emergency plumber" in one metro may be 200/month and convert at 20%; a content query at 40,000/month may monetize at $8 RPM. Ranking candidates by search volume is correct for B and actively misleading for A. **The priority scorer is not shared** — A ranks by estimated job value, B by estimated traffic value.

### `pageType` matters more than `archetype`

Archetype is not cleanly a property-level fact. A plumber with a blog is both. A SaaS company runs money pages *and* a large content operation on one domain.

So `archetype` sets **defaults**, but the operative switch is **`pageType` per URL**:

| `pageType` | Judged on | Example |
|---|---|---|
| `money` | Conversion | `/services/drain-cleaning`, `/pricing` |
| `content` | Traffic + downstream assists | `/blog/why-drains-clog` |
| `local` | Local pack presence | `/service-areas/fairfield` |
| `utility` | Nothing — excluded | `/privacy`, `/contact` |

This reframes internal linking for archetype A: content pages exist to pass authority and users **downstream to money pages**, so *"does this page link to a money page?"* becomes a first-class check with no archetype-B equivalent. A content page ranking beautifully and feeding nothing is a failure that a traffic-only scorer would happily mark `LEAVE`.

### What archetype A adds

Three inputs that archetype B never needs:

1. **Location as a key, not a filter.** A service business has no single position for "drain cleaning" — it has one per service area. `serp_snapshots` already keys on `(query, location)`, which was accidentally right, but cardinality rises 10–50× (20 areas × 30 queries = 600 SERPs vs. 30). Cost stays trivial (~$0.36/mo); the real impact is that **`ourPosition` becomes a distribution, not a scalar**, and every position-reading detector must handle that.
2. **Conversion signal.** Clicks are not the goal. A page at position 2 with strong CTR and zero calls is a *failure* that the traffic model scores as `LEAVE`. Requires a new ingest — GA4 events, call tracking, or form submissions. The first data source that comes from neither Google nor DataForSEO.
3. **Google Business Profile.** Organic rank while absent from the map pack is close to worthless for local service. Pulls in DataForSEO's **Business Data API** (Maps listings, reviews, categories) — a product line archetype B ignores entirely. Brings its own checks: category correctness, review count and velocity vs. competitors, NAP consistency across citations, photo count, hours completeness.

### Archetype-specific verdicts

`MERGE`, `REFRESH`, and `RETIRE` barely apply to a 20-page service site. Archetype A adds:

| Verdict | Trigger |
|---|---|
| `ADD_SERVICE_AREA_PAGE` | Serves an area with no page targeting it |
| `GBP_FIX` | Profile incomplete, miscategorised, hours/photos missing |
| `REVIEW_GAP` | Review count or velocity far behind local competitors |
| `CITATION_FIX` | NAP inconsistent across directories |
| `CONVERSION_FIX` | Ranks and gets clicks, produces no contacts |

`enabledVerdicts[]` in the property config (§2) is what gates these, so the verdict enum stays one list with per-property subsets rather than forking into two systems.

### `local` is its own axis

Archetype A splits again. **Software** is a funnel site with conversion goals but no service area, no GBP, and no local pack — generating `GBP_FIX` for a SaaS company would be nonsense.

| | `local: true` | `local: false` |
|---|---|---|
| Examples | plumbing, roofing, salon | software, agency, consulting |
| SERP surface | Map pack + organic | Organic only |
| Rank tracking | Per service area | National |
| GBP ingest | Required | Skipped |
| Conversion goal | Calls, bookings | Trials, demos, signups |

`local` gates the GBP surface and the location dimension; `archetype` gates the conversion scorer. They are independent.

### What stays shared

The entire raw layer: GSC ingest, page snapshots, crawl, annotations, SERP storage, keyword metrics, and the closing-the-loop machinery. **Both archetypes are the same data spine with different detectors and a different scorer bolted on.** Nothing below Part 4 changes.

---

## 0. Principles

**Store raw observations, never conclusions.** A raw observation is perishable — if we don't record what the SERP looked like on 2026-07-22, that fact is gone forever. Conclusions ("this page is a good opportunity") are recomputable and *will* change as the formulas improve. Derived data is disposable and regenerated on demand.

**The sites are not participants.** No site calls this tool and this tool calls no site's database. Data flows in from Google Search Console and from SERP APIs; on-page facts come from crawling. This is a standalone app with a `properties` collection, not a service with clients. Crawling rather than integrating is what makes it work uniformly across properties we don't own and stacks we didn't build.

**Multi-property now, multi-tenant later.** A `propertyId` foreign key on every row costs nothing today and is expensive to retrofit. Logins, data isolation, per-user credentials, and billing are a *product* — defer until someone actually asks.

**~90% of this is vertical-independent.** The ingest, the storage schema, every detector, and the scoring function are the same for a gardening site and a B2B SaaS blog. Striking distance is `position BETWEEN 5 AND 20 AND impressions > N` regardless of subject. What varies is **configuration and prompt text, never code** — see §2.

**Credentials:** one Google service account. Each property owner adds that service account's email as a user on their Search Console property. No OAuth consent screen, no Google app-verification process, no 100-test-user cap.

**Batch to the cap.** DataForSEO bills per *task* plus per *row*, and the task fee dominates at small batch sizes. Google Ads search volume is $0.06 per task for **up to 1,000 keywords** — requesting 40 costs the same as requesting 1,000. Fill the batch, and pool across properties where the endpoint allows it.

**Never use live mode.** Everything here runs from cron; nothing waits on a response. Standard/normal priority is $0.0006 per SERP vs $0.002 live — 70% cheaper for a delay nobody experiences.

---

## Part 1 — Cold Start

One-time diagnostic run against a newly-added property. **Total cost: under $5.**

Steps 1–4 are the *diagnosis* — run them first, for about twelve cents, then stop and read the result. They determine which mode the property is in:

- **Latent traction** (`ranked_keywords` returns hundreds of rows) → optimize existing pages. Steps 5–10 are secondary.
- **Coverage building** (returns near-nothing) → skip optimization entirely, go to 5–7, start writing.

These are different strategies and we don't know which applies until step 2 returns. Every property gets classified this way on intake.

### The ten calls

| # | Question | Endpoint | Cost | Save to |
|---|---|---|---|---|
| 1 | Do I rank for anything at all? | `dataforseo_labs/google/domain_rank_overview/live` | ~$0.01 | `property_snapshots` |
| 2 | What exactly, and from which page? | `dataforseo_labs/google/ranked_keywords/live` | ~$0.07 | `ranked_keywords` |
| 3 | Which of my pages have traction? | `dataforseo_labs/google/relevant_pages/live` | ~$0.02 | `ranked_keywords` (page rollup) |
| 4 | Who am I actually competing with? | `dataforseo_labs/google/competitors_domain/live` | ~$0.02 | `competitors` |
| 5 | What do they rank for that I don't? | `ranked_keywords/live` × top 6 competitors | ~$1.00 | `ranked_keywords` (their propertyId) |
| 6 | What else could I write about? | `keyword_ideas` + `keyword_suggestions` + `related_keywords` | ~$0.70 | `keyword_candidates` |
| 7 | Which can I realistically win? | `dataforseo_labs/google/bulk_keyword_difficulty/live` | ~$0.25 | `keyword_metrics` |
| 8 | Which intents are in scope? | `dataforseo_labs/google/search_intent/live` | ~$0.25 | `keyword_metrics` |
| 9 | How big, and *when* in the year? | `keywords_data/google_ads/search_volume/live` | ~$0.12 | `keyword_metrics` + `keyword_seasonality` |
| 10 | What does page 1 actually look like? | `serp/google/organic/task_post` on shortlist | ~$0.12 | `serp_snapshots` |

### Notes on specific steps

**Step 4 seeds itself.** The property config supplies a hand-written starting competitor list; step 4 confirms, ranks, and expands it. The returned set is usually not who the owner assumed.

**Step 5 — compute the gap locally.** `domain_intersection` returns keywords where *both* domains rank; the gap is the opposite. Pull `ranked_keywords` for each competitor, pull ours, and set-difference in our own code. Same cost, no fighting endpoint semantics.

**Step 6 seeds from config.** Expansion is only as good as `seedTopics`. This is the single most leveraged config field — a bad seed list produces a large, confident, irrelevant keyword universe.

**Step 8 filters by config.** Which intents count as in-scope is per-property (`intentFilter`). A content-only site drops commercial and transactional queries — they look attractive on volume and CPC and are worthless without something to sell. A storefront inverts that filter entirely.

**Step 9 — seasonality is purchasable retroactively.** `search_volume` accepts `date_from`/`date_to` and returns up to **four years** of monthly history; `historical_keyword_data` reaches back to 2019. We never need to wait a year to learn a demand curve — we compute it on intake and publish 6–8 weeks ahead of each peak.

> *Worked example:* on a gardening property this is the highest-value call on the list, because demand swings violently by week and most competitors publish reactively, in-season, which is structurally too late. On a property with `seasonality: none`, this step collapses to a plain volume lookup.

### Cold-start outputs

Three artifacts, all regenerable from the saved raw data:

1. **Retitle list** — existing pages, the queries they're closest to winning, and what their titles should say instead.
2. **Gap list** — topics competitors own where we have no page at all.
3. **Publish calendar** — those topics ordered by when in the year demand actually peaks (omitted for non-seasonal properties).

### Free prerequisite

Before any of the above: **verify the property in Google Search Console and start the daily ingest.** GSC backfills 16 months *once* — connecting today reaches back to ~March 2025, and every day of delay permanently loses a day off the back end. It is free, and for questions about our own sites it is strictly better than DataForSEO's *estimate* of them.

DataForSEO's unique value is steps 4–6 — competitors. Nothing Google provides will ever tell us what someone else ranks for.

---

## Part 2 — Per-Vertical Configuration

Everything that differs between properties lives here. **No detector reads the vertical directly**; they read these fields.

```
PropertyConfig {
  domain
  gscPropertyUrl
  archetype                      // service | content — sets defaults below
  locationCode, languageCode     // SERP + volume calls
  seedTopics[]                   // drives step 6 expansion
  seedCompetitors[]              // step 4 starting point, then expanded
  intentFilter[]                 // which search intents are in scope
  seasonality                    // none | mild | strong — gates REFRESH
  entitySchema[]                 // structured facts a good page here contains
  formatPriors[]                 // expected page-1 shapes for this vertical
  urgencyTerms[]                 // vertical vocabulary for title-composition counts
  verdictThresholds{}            // exposed in output; consumer may re-derive
  enabledVerdicts[]              // gates archetype-specific verdicts
  ymyl                           // bool — raises E-E-A-T checks (health, finance, legal)

  // archetype: service only
  serviceAreas[]                 // locations to track rank across
  gbpPlaceId                     // Google Business Profile to monitor
  conversionSource               // ga4 | call-tracking | form-webhook | none
  avgJobValue                    // powers the priority scorer
}
```

**`ymyl` is a third axis, orthogonal to both archetype and vertical.** Health, finance, and legal content is held to a higher E-E-A-T bar by Google regardless of which archetype it sits in. When true, it enables author-credential, citation, and review-process checks that are noise elsewhere. A psychedelics or supplements property is YMYL content; a personal-injury firm is YMYL service.

**`entitySchema` is the field that does the most work.** It defines what "complete coverage" means for check F, and it is pure data:

| Vertical | `entitySchema` |
|---|---|
| Gardening | zone, spacing, sun, days-to-maturity, soil pH, sow window, companions |
| Recipes | prep time, cook time, servings, calories, equipment, allergens |
| SaaS reviews | pricing tiers, platforms, integrations, free tier, support model |
| Local services | service area, hours, licensing, pricing model, response time |

Adding a vertical means writing a config row. It never means touching a detector.

**`seasonality` gates behavior, not just data.** On `none`, the `REFRESH` verdict is disabled and the publish calendar is not generated. On `strong`, refresh timing becomes a first-class priority input.

---

## Part 3 — Per-Page Analysis

The recurring loop. For each URL on a property, produce a **verdict** and the evidence behind it.

### Inputs

| Input | Source | From cold start? | Refresh |
|---|---|---|---|
| Actual clicks/impressions/CTR/position per query | GSC Search Analytics | No — ongoing | Daily |
| Indexed? Google's chosen canonical? | GSC URL Inspection | No — ongoing | Weekly |
| Title, H1, headings, word count, schema, links, images | Our crawler | No — ongoing | Weekly + on publish |
| Declared target query for this page | Human-authored | No | On edit |
| Keyword volume / difficulty / intent | Steps 7–9 | **Yes** | Quarterly |
| Seasonality curve | Step 9 | **Yes** | Annually |
| SERP composition for target query | Step 10 | **Yes** | Monthly / weekly for watchlist |
| Competitor keyword sets | Step 5 | **Yes** | Quarterly |

Roughly: **the cold start supplies market context; the ongoing ingest supplies our own performance.** Market context is slow-moving and cheap to refresh. Our own performance must be captured daily and can never be reconstructed.

### The checks

**A · Targeting**
- Does the page's declared target query match what it actually ranks for?
- **Cannibalization:** does another page on this property rank for the same query? Two pages splitting impressions on one query is a merge candidate.

**B · Coverage**
- Indexed? If not — why (crawled-not-indexed, discovered-not-crawled, excluded by noindex)?
- Does Google's chosen canonical match our declared canonical? A mismatch means Google folded this page into another and we are invisible.
- **Orphaned?** Zero internal links pointing in.
- Present in the sitemap?

**C · Position**
- Current position for the target query, and the trend (rising / falling / flat) over 30 and 90 days.
- **Striking distance:** position 5–20 with meaningful impressions. Highest-ROI bucket.

**D · CTR**
- Actual CTR vs. expected CTR for that position, using a curve computed from our own pooled data across properties. A single small site never has enough impressions to build a trustworthy curve; six pooled properties might.
- Pool the curve **per vertical where volume allows**, since CTR-by-position differs by SERP composition. Fall back to the global pooled curve when a vertical is thin.
- Adjust expectation downward when the SERP carries an AI Overview or a large answer block — a "CTR deficit" at position 3 under an AI Overview may be normal, not a title problem.

**E · Intent & format**
- What format dominates page 1 — listicle, video, comparison table, calculator, forum thread?
- Does our page match it? Ranking #8 with a prose essay against ten structured tables is a restructure, not a rewrite.
- Compare against `formatPriors` to distinguish a genuine shift from this vertical's normal state.
- SERP features present: AI Overview, People Also Ask, video carousel, image pack, local pack.

**F · Content coverage**
- Which related queries and PAA questions does this page fail to address?
- Which fields from `entitySchema` do top results include that we omit?
- Depth vs. the top-10 median word count — crude, directional only, never a target.

**G · On-page technical**
- Title contains the target query's actual language?
- H1 aligned with title and target?
- Meta description present?
- Schema present and valid? *(Note: Google removed HowTo rich results entirely and restricted FAQ rich results to authoritative gov/health sites. Schema now earns machine-readability and entity clarity, not SERP decoration. Do not invest expecting rich snippets.)*
- Internal links out to related pages on the property?
- Image alt text present?

**H · Freshness & season**
- When does demand for this query peak? *(skipped when `seasonality: none`)*
- When was the page last substantively edited — content hash change, not a timestamp bump?
- Is it due for a refresh *ahead* of its season?

### Verdicts

Each run assigns exactly one primary verdict per page, so the output is a worklist rather than a report:

| Verdict | Trigger | Action |
|---|---|---|
| `LEAVE` | Performing at/above expectation | Nothing |
| `FIX` | Not indexed, canonical mismatch, orphaned | Technical — do first, blocks everything else |
| `RETITLE` | Good position, CTR deficit, content fine | Rewrite title + meta |
| `EXPAND` | Striking distance + coverage gap | Add the missing subtopics and entity fields |
| `RESTRUCTURE` | Ranks, but format mismatches SERP intent | Reshape the page |
| `MERGE` | Cannibalizing another page | Consolidate, redirect the loser |
| `REFRESH` | Seasonal peak approaching, content stale | Update ahead of the curve |
| `RETIRE` | No impressions, no realistic path | Noindex or delete |

`FIX` outranks everything — there is no point optimizing a title on a page Google has canonicalized away.

### Cadence & cost

| Job | Frequency | Why | Monthly, 6 properties |
|---|---|---|---|
| GSC performance ingest | Daily | Free; revised ~3 days, so re-pull a trailing 7-day window and upsert | $0 |
| GSC URL inspection | Weekly | 2,000/day quota, ample | $0 |
| Site crawl → page snapshot | Weekly + on publish | Hash-deduped, only writes on change | $0 |
| SERP — striking-distance watchlist | Weekly | Pages actively being worked | ~$1 |
| SERP — full tracked set | Monthly | Baseline drift | ~$1 |
| Keyword volume + difficulty | Quarterly | Slow-moving | ~$1 |
| Search intent | Once per keyword | Effectively permanent | negligible |
| Competitor `ranked_keywords` | Quarterly | Slow-moving | ~$4 |
| Competitor set re-identification | Quarterly | Slow-moving | negligible |
| Seasonality history | Annually | 4-year pull, one shot | negligible |
| **Total** | | | **~$10–15/mo** |

The $50 minimum deposit is roughly a year of runway. **Cost is not a design constraint** — do not build budget guards, spend throttles, or response caching to save fees. That machinery costs more in engineering time than it could ever save. The only discipline that matters is batching, because that is a 100× difference rather than a 20% one.

---

## Part 4 — Data Model

Every row carries `propertyId`.

### Raw — permanent, never deleted

**`properties`** — the `PropertyConfig` from §2, plus `ownerId` and `active`

**`search_performance_daily`** ← *the core asset*
`propertyId`, `date`, `page`, `query`, `country`, `device`, `clicks`, `impressions`, `ctr`, `position`

Grain is deliberately the finest GSC provides. We can always sum daily rows into months; we can never split a month back into days to learn whether a drop was a gradual slide (competitors) or a cliff on one date (algorithm update). Storing monthly rollups instead is the most common and most destructive mistake in this whole design.

Upsert on `(propertyId, date, page, query, country, device)` — GSC revises the last ~3 days.

**`url_index_status`**
`propertyId`, `url`, `checkedAt`, `indexed`, `googleCanonical`, `declaredCanonical`, `lastCrawled`, `coverageState`, `robotsState`

**`page_snapshots`** — written only when `contentHash` changes
`propertyId`, `url`, `capturedAt`, `contentHash`, `title`, `metaDescription`, `h1`, `headings[]`, `wordCount`, `schemaTypes[]`, `canonical`, `statusCode`, `internalLinksOut[]`, `images[]`, `publishedAt`, `modifiedAt`

The dataset everyone skips, and what closes the loop. Without a record of what the page said in March, we can never answer "did the rewrite work?" — causality becomes permanent guesswork.

**`serp_snapshots`**
`query`, `location`, `capturedAt`, `results[]` *(position, url, domain, title, snippet, type)*, `features[]`, `ourPosition`

Store the **entire** SERP, not just our position. Storing "we were #8" discards the only data that can later explain a 30% click loss at unchanged position. Keyed by query rather than property — two properties targeting one query share the snapshot.

**`keyword_metrics`**
`query`, `capturedAt`, `searchVolume`, `cpc`, `competition`, `difficulty`, `intent`, `monthlySearches[]`

**`keyword_seasonality`** — derived from step 9's 4-year pull, refreshed annually
`query`, `peakWeeks[]`, `troughWeeks[]`, `amplitude`, `sourceMonths[]`

**`conversions_daily`** — *archetype A only*
`propertyId`, `date`, `landingPage`, `source`, `sessions`, `conversions`, `conversionType`, `estimatedValue`

Joins to `search_performance_daily` on `(propertyId, date, page)`. Without it, archetype A is being scored on a metric its owner does not care about.

**`gbp_snapshots`** — *archetype A only*
`propertyId`, `placeId`, `capturedAt`, `categories[]`, `reviewCount`, `rating`, `photoCount`, `hoursComplete`, `attributes[]`, `competitorSet[]`

Weekly. Review count and velocity only mean anything relative to the local competitor set, so competitors are captured in the same snapshot.

**`annotations`** ← *highest value per byte on this list*
`propertyId`, `date`, `url?`, `type` *(edit | publish | technical | algo-update | migration)*, `description`, `author`

Costs almost nothing and is worthless if started late. Start it before building anything else — a text file is an acceptable v1. Algo-update entries apply across all properties at once and are how you distinguish "we broke something" from "the weather changed."

### Derived — regenerable, safe to drop

**`page_targets`** — human-authored intent
`propertyId`, `url`, `pageType`, `targetQuery`, `secondaryQueries[]`, `notes`

`pageType` determines which detectors run and which metric defines success. Defaulted from URL patterns on intake, confirmed by hand.

**`page_analysis`** — one row per page per run
`propertyId`, `url`, `runAt`, `formulaVersion`, `verdict`, `evidence{}`, `priorityScore`

Stamped with `formulaVersion` so runs stay comparable as detectors change, and so the collection can be dropped and rebuilt from raw at any time.

### Size

Six properties over three years lands in the low single-digit gigabytes, dominated by `search_performance_daily` and `serp_snapshots`. A 50-page site produces roughly 500–2,000 GSC rows/day (only rows with impressions are returned).

**Do not build pruning or retention logic.** Deleting old data to save a few dollars trades away the only thing here that cannot be bought back.

---

## Part 4b — The Advisory Engine

Everything above **measures**. This part **prescribes** — it turns diagnosis into a work order a human can act on without knowing SEO.

Target output, in the caller's words: *"oh I see — I need to reword this, this blog post needs adjusting in these ways, and we need to do X, Y, Z for meta tags and JSON-LD."*

### It works with zero history

The critical property for archetype A. A service business that launched last month has no GSC data, but a full work order needs only four inputs, all available at first contact:

1. `BusinessProfile` — supplied by the caller
2. Current page content — our crawl
3. The SERP for each target query — DataForSEO
4. The top-10 ranking competitor pages — crawl them too

**No time series required.** The measurement spine makes recommendations *better* over time and lets us prove they worked, but it is not a precondition for value. Archetype A must be useful on day one or it will never be adopted.

### Intake

```
BusinessProfile {
  name, legalName, primaryCategory      // → schema.org type
  services[]                            // each → page + Service schema
  serviceAreas[]                        // each → location page candidate
  address | serviceAreaBusiness         // SAB hides address by design
  phone, hours, priceRange
  licenses[], certifications[], insurance
  yearsInBusiness, differentiators[]
  brandVoice                            // tone constraint for generation
}
```

**This intake is the moat.** Most archetype-A findings are not "your SEO is wrong" — they are **"your site doesn't say what your business actually is."** A plumber whose pages never mention *emergency*, *24/7*, *licensed*, or the city name is failing for reasons no keyword tool can diagnose, because the missing information exists only in the owner's head. Nothing in the DataForSEO or GSC surface can substitute for it.

### No generation. Hard values only.

**There is no LLM anywhere in this pipeline.** The tool consumes, records, and emits measured facts. The caller supplies content and company meta, receives numbers and sets, and decides entirely on their own how to incorporate them.

This is a deliberate constraint, and it buys a lot:

- Every output is a pure function of stored inputs — **unit-testable with exact assertions**
- Reproducible and cacheable; identical inputs always yield identical output
- Diffable across runs, because nothing is stochastic
- No hallucination surface, no prompt maintenance, no token budget
- The consumer may be a human, a CMS, or another agent — none of them need our opinion embedded

**We never write prose the caller ships.** We report what is observably true about their page, the SERP, and their business profile. Wording is the caller's job.

### The four fact families

**1 · Page facts** — measured from the caller's content

| Fact | Type |
|---|---|
| Title, length, contains city / service / brand | string, int, bool |
| Meta description present, length | bool, int |
| H1 count, H2/H3 text list | int, string[] |
| Word count | int |
| Schema types present | string[] |
| Images total / missing alt | int, int |
| Internal links out, inbound internal links | int, int |
| Phone present, in header, `tel:` linked | bool ×3 |
| NAP exact-match against `BusinessProfile` | bool ×3 |

**2 · SERP facts** — measured across the top 10 for the target query and location

| Fact | Type |
|---|---|
| Ranking URLs, domains, titles, metas | string[] |
| Title length min / median / max | int ×3 |
| Count containing city / number / year / urgency term / brand | int ×5 |
| Word count min / median / max | int ×3 |
| H2 strings by frequency across top 10 | {string: int} |
| Schema types by frequency | {string: int} |
| SERP features present | string[] |
| Result composition: directory / national / local business | int ×3 |

**3 · Delta facts** — set arithmetic and numeric comparison, wholly deterministic

| Fact | Type |
|---|---|
| Terms in ≥N competitor titles, absent from yours | string[] |
| N-grams in ≥N competitor bodies, absent from yours | string[] |
| H2 topics common to top 10, absent from yours | string[] |
| PAA questions with no term match on your page | string[] |
| `entitySchema` fields not detected on your page | string[] |
| Schema types on ≥N competitors that you lack | string[] |
| Word-count delta vs. top-10 median | int |
| Services in profile with no page | string[] |
| Service areas in profile with no page | string[] |

**4 · Keyword & performance facts**

| Fact | Type | Source |
|---|---|---|
| Volume, CPC, competition, difficulty, intent | numeric, enum | DataForSEO |
| Monthly volume history, peak/trough week, amplitude | int[], int, float | Google Ads, 4yr |
| Impressions, clicks, CTR, position | numeric | GSC, when connected |
| CTR delta vs. pooled expected-CTR-at-position | float | computed |
| Position trend, 30 / 90 day | float ×2 | computed |

GSC facts are **optional enrichment**. Their absence removes family 4's second half and nothing else.

### Coverage without judgment

"What does this page fail to cover" looks like it needs an LLM. It does not — it is frequency analysis:

- N-grams appearing in ≥N of the top 10 bodies and absent from yours
- H2/H3 strings recurring across ranking pages and absent from yours
- PAA question terms with no match in your text
- `entitySchema` fields with no detected value

Cruder than a model would be, and entirely deterministic. This makes **`entitySchema` the load-bearing config field** — it is the explicit, per-vertical list of facts a page should contain, verified by pattern match. Extending coverage detection means extending that list, never touching a detector.

### Verdicts are threshold labels, not advice

The Part 3 verdicts survive as **pure functions with their rule attached**:

```
EXPAND  ⟸  position ∈ [5,20] AND missingEntityFields ≥ 3
RETITLE ⟸  position ≤ 10 AND ctrDelta < -0.3 AND missingTitleTerms ≥ 1
```

Every emitted verdict carries the rule and the operand values that fired it. Thresholds live in config and are exposed in the output, so a consumer who disagrees can ignore our labels and re-derive from the raw facts. **A verdict is a computed classification, never a recommendation.**

### JSON-LD is pure mapping, not generation

Highest-value output and most visibly missing on real service sites — and it requires no judgment whatsoever, because it is a lookup against schema.org's vocabulary joined to the intake.

schema.org provides exact `LocalBusiness` subtypes — `Plumber`, `RoofingContractor`, `HVACBusiness`, `Electrician`, `HairSalon`, `Locksmith`, `HousePainter`, `GeneralContractor`, `MovingCompany` — so the correct `@type` falls straight out of `primaryCategory`, and every property maps directly from intake:

| Schema property | Source |
|---|---|
| `name`, `telephone`, `priceRange` | intake |
| `address` (PostalAddress) | intake, omitted for SAB |
| `areaServed` | `serviceAreas[]` |
| `openingHoursSpecification` | intake hours |
| `aggregateRating` | `gbp_snapshots` |
| `sameAs` | discovered citations |
| `hasOfferCatalog` / `Service` | `services[]` |

**The hard value is the property table** — required, recommended, present, missing, and the intake value that maps to each. A fully assembled block per page type (`LocalBusiness` on home/contact, `Service` on service pages, `BreadcrumbList` sitewide) is a free byproduct of that mapping, offered as a convenience. Both are deterministic; neither is generated.

> *Caveat carried from Part 3:* Google removed HowTo rich results and restricted FAQ rich results to authoritative gov/health sites. JSON-LD here earns machine-readability, entity clarity, and local-pack corroboration — **not** SERP decoration. Say so in the work order so callers do not expect visual results.

### Every fact carries provenance

A number without its source is unusable — the consumer cannot weigh it or re-derive it.

> ❌ `titleMissingTerms: ["emergency", "24/7"]`
> ✅ `titleMissingTerms: [{term: "emergency", competitorCount: 7, of: 10, query: "plumber fairfield oh", observedAt: "2026-07-22"}]`

Provenance comes free from `serp_snapshots` and competitor crawls, which we already store. **Every fact ships with its source, its sample size, and its observation date.**

### Response shape — swaps

The four fact families above are **internal computation**. What the consumer receives is a flat list of swaps: what they have, what the data says to use, and a score for each.

```jsonc
{
  "url": ".../garden-skills/garden-skill/trees-of-the-north",
  "query": "cold hardy trees",

  "swaps": [
    {
      "area":           "title",
      "current":        "Trees of the North",
      "currentScore":   12,
      "suggestedScore": 84,
      "signals": {
        "terms": [
          { "term": "cold hardy", "in": 8, "of": 10 },
          { "term": "zone",       "in": 8, "of": 10 },
          { "term": "best",       "in": 5, "of": 10 }
        ],
        "patterns": [
          { "pattern": "leadsWithCount", "in": 7, "of": 10 },
          { "pattern": "containsYear",   "in": 3, "of": 10 }
        ],
        "lengthMedian": 54,
        "examples": [
          "23 Cold Hardy Trees for Zone 3 Gardens",
          "Best Cold Hardy Trees: Zone 2-5 Varieties",
          "Cold Hardy Trees — A Complete Zone Guide"
        ]
      }
    },
    {
      "area":           "headings",
      "current":        ["Choosing a Site", "Planting", "Winter Care"],
      "currentScore":   30,
      "suggested":      ["Hardiness Zones", "Best Varieties", "Planting Time"],
      "suggestedScore": 90
    },
    {
      "area":           "facts",
      "current":        [],
      "currentScore":   0,
      "suggested":      ["hardinessZone", "matureHeight", "sunRequirement", "soilType"],
      "suggestedScore": 100
    },
    {
      "area":           "entities",
      "current":        ["Norway spruce"],
      "currentScore":   15,
      "suggested":      ["paper birch", "American larch", "quaking aspen", "balsam fir"],
      "suggestedScore": 85
    },
    {
      "area":           "questions",
      "current":        [],
      "currentScore":   0,
      "suggested":      ["what trees survive zone 3 winters",
                         "when to plant trees in cold climates",
                         "how fast do cold hardy trees grow"],
      "suggestedScore": 75
    },
    {
      "area":           "schema",
      "current":        ["Article"],
      "currentScore":   40,
      "suggested":      ["Article", "ItemList"],
      "suggestedScore": 80
    },
    {
      "area":           "meta",
      "current":        null,
      "currentScore":   0,
      "suggestedScore": 60,
      "signals": {
        "terms": [
          { "term": "zone",     "in": 7, "of": 10 },
          { "term": "varieties","in": 5, "of": 10 }
        ],
        "lengthMedian": 148,
        "examples": [
          "Discover 23 cold hardy trees that thrive in zone 3. Mature height, sun needs and soil for each.",
          "Which trees survive northern winters? Zone-by-zone varieties with planting times."
        ]
      }
    },
    {
      "area":           "links",
      "current":        0,
      "currentScore":   0,
      "suggested":      3,
      "suggestedScore": 70
    }
  ]
}
```

### Areas

| Area | Answers |
|---|---|
| `title` | What to call it |
| `meta` | What the snippet should say |
| `headings` | What sections to have |
| `facts` | Which fact *types* to state — from `entitySchema` |
| `entities` | Which specific *items* to name |
| `questions` | Which questions to answer |
| `schema` | What to mark up |
| `links` | How many inbound internal links it needs |
| `length` | How long it should be |

**There is no prose-level swap, by design.** Body content is not one area — it is the sum of the structural ones. Hand a consumer the existing content plus these nine rows and the rewrite is fully specified, with nothing left for us to generate.

`facts` and `entities` are complementary and easy to conflate: `facts` are the fact *types* a page in this vertical should state (`hardinessZone`, `matureHeight`); `entities` are the specific *instances* the ranking pages actually cover — species here, tools or brands or ingredients elsewhere. Both are deterministic: `facts` from `entitySchema` pattern matching, `entities` from proper nouns and domain terms recurring across competitor bodies, differenced against the caller's page.

**Score** = percentage of observed competitive features matched, weighted by frequency across the top 10. Pure arithmetic — no judgment, no generation.

Sort by `suggestedScore - currentScore` and the top row is the highest-leverage change.

**No rationale is emitted.** The consumer asked for values, not argument. Provenance, verdicts, and full SERP distributions remain available behind `?include=`, but never appear by default.

### Two swap shapes

| Shape | Areas | Payload |
|---|---|---|
| **`suggested`** | `headings` · `facts` · `schema` · `links` · `length` | The observed competitor data *is* the answer — a set to add |
| **`signals`** | `title` · `meta` | Raw ingredients: term frequencies, structural patterns, median length, and verbatim competitor examples |

**We never write prose the caller ships.** Title and meta have no `suggested` string by design — assembling one from a template is deterministic but reads mechanically, and any consumer with a model will write something better from the raw signals than our template could.

`suggestedScore` is still emitted for prose areas: it is the score achievable by matching all observed signals, so the consumer can measure their own rewrite against it.

**`examples[]` is the highest-value field for an AI consumer.** Verbatim titles and metas from the pages currently ranking, free from data already stored — better rewrite input than any instruction we could phrase.

Structured JSON is the artifact; markdown and UI are **renders** of it. Structured output means runs are diffable month over month, and the response can be consumed by a CMS, a script, or another agent as readily as by a person.

Fact sheets are **derived and disposable** — regenerate from raw at any time. Only the *action taken* is durable, and that goes to `annotations`.

### Build note

The whole engine is pure functions over stored DTOs. It maps cleanly onto the hexagon: fact families are domain computations, DataForSEO and GSC sit behind ports, and the fact sheet is an output DTO. **Every detector is directly unit-testable with fixture SERPs and fixture pages — no network, no fakes beyond the port doubles, no non-determinism to work around.**

---

## Part 4c — History as Private Enrichment

**The consumer never receives history.** They send content, company meta, and a target query; they receive present-tense hard values. Everything in Parts 1–4 accumulates on our side and silently improves those values.

This is not a contradiction of the hard-values contract. `serpVolatility90d: 0.31` is as hard a value as `titleLength: 38` — it simply cannot be computed by anyone who was not recording. Provenance reports *"47 observations over 14 months"*, never the observations themselves.

### What history adds to a fact sheet

| Fact | Requires | Without history |
|---|---|---|
| `ctrDelta` vs. pooled expected-CTR-at-position | Cross-property GSC | ⛔ null |
| `serpVolatility90d` — how much the top 10 churns | ≥3 SERP snapshots | ⛔ null |
| `top10Churn` — entrants and exits since last observation | ≥2 snapshots | ⛔ null |
| `competitorTrajectory` — who is climbing, since when | ≥3 snapshots | ⛔ null |
| `termStability` — is "emergency" a 12-month norm or a 3-month shift | ≥6 snapshots | count only |
| `contentNormDrift` — is top-10 median word count rising | ≥6 snapshots | median only |
| `positionTrend30/90` | GSC daily | ⛔ null |
| Fact **ordering** by empirical predictive value | Outcome history | static order |
| Verdict **thresholds**, calibrated | Outcome history | hand-set defaults |

The last two are the deepest. Today's thresholds (`position ∈ [5,20]`, `missingEntityFields ≥ 3`) are guesses. Once `page_analysis` → `annotations` → `search_performance_daily` closes the loop across many properties, they become empirical — and the facts in a sheet can be *ordered by which ones actually predicted movement* rather than by which ones we assumed mattered.

### Graceful degradation is mandatory

A fact sheet with no history behind it must return **explicit nulls with an `insufficientHistory` reason**, never a fabricated or defaulted number.

```
serpVolatility90d: { value: null, reason: "insufficient_history",
                     observations: 1, required: 3 }
```

Day-one output stays honest; year-two output is genuinely better. Silently substituting a global default for a missing per-query value would poison the one thing this design is built to protect.

### The corpus flywheel, and its boundary

Every consumer request causes us to pull and store a SERP. More consumers → more queries observed → better volatility and trajectory data → better facts for everyone. That flywheel is real, and it only works with an explicit line:

| Pools across all consumers | Never pools |
|---|---|
| `serp_snapshots` | Caller-supplied page content |
| Competitor page crawls | `BusinessProfile` |
| `keyword_metrics`, `keyword_seasonality` | `search_performance_daily` rows |
| Derived SERP volatility & norms | `conversions_daily` |

The left column is **public observation** — nobody owns what ranks for a query. The right column is the consumer's own data.

**The pooled expected-CTR curve sits exactly on this line**, since it is built from GSC performance. Aggregate-only contribution — position buckets and rates, never rows, never attributable to a property — is standard practice and defensible, but it must be a **stated policy** rather than an emergent accident. It is the single place private data feeds a shared artifact.

### Schema implication

Nothing new is stored; the existing collections already separate correctly. `serp_snapshots` and `keyword_metrics` key on `(query, location)` with no `propertyId` — they were already the shared corpus. Everything carrying `propertyId` is private by construction.

Two derived, disposable additions:

**`serp_history_rollups`** — `query`, `location`, `windowDays`, `volatility`, `churnedDomains[]`, `titleTermFrequency{}`, `wordCountMedian`, `observationCount`

**`threshold_calibration`** — `verdictLabel`, `archetype`, `vertical`, `thresholds{}`, `sampleSize`, `hitRate`, `computedAt`

Both regenerate from raw. Neither is ever exposed.

---

## Part 5 — Closing the Loop

What makes this better than a commercial tool over time, and the reason `annotations` and `page_snapshots` matter:

1. Analysis issues a verdict → recorded in `page_analysis`
2. We act → recorded in `annotations`, content change captured in `page_snapshots`
3. 30–60 days later, measure position and CTR movement in `search_performance_daily`
4. Feed that back: **which verdict types actually produce results, and in which verticals?**

Within a year that answers a question no vendor can. And because verdict outcomes are tagged by property, the answer sharpens per vertical rather than collapsing to one global average — `EXPAND` may reliably win on informational content and do nothing on commercial pages. A hosted tool cannot learn from our edits. This can.

---

## Part 6 — Portfolio-Level Analysis

Available once ≥2 properties are ingesting, and structurally impossible for single-domain commercial tools:

- **Cross-property cannibalization** — two of our sites competing for one query, splitting clicks
- **Topic allocation** — which property should own which cluster, based on existing authority signals
- **Cross-network internal linking** — highest-value link opportunities between properties
- **Pooled CTR curves** — a statistically usable position→CTR baseline no individual small site has the impressions to produce
- **Shared verdict priors** — outcome data from six properties tunes the detectors faster than one property ever could

---

## Part 7 — Build Order

1. `properties` + GSC daily ingest → `search_performance_daily`. **Do this first** — it is the only clock actually running, and it backfills 16 months exactly once. Onboard *every* property here immediately, even ones not yet being worked; the backfill window is closing on all of them simultaneously.
2. `annotations`, even as a flat file.
3. Crawler → `page_snapshots`, before any content editing begins.
4. GSC URL inspection → `url_index_status`.
5. Cold start steps 1–4 on the first property. Read the result, classify the mode.
6. Detectors for `FIX`, `RETITLE`, `EXPAND` — these need no paid data.
7. Cold start steps 5–10, DataForSEO adapters, `serp_snapshots`.
8. Remaining detectors, `page_analysis`, priority scoring.
9. Second property — **ideally the other archetype**, not merely a different vertical. A second content site would validate almost nothing; a service funnel forces `pageType`, the location dimension, and the conversion ingest to be real rather than theoretical.

Validate first against whichever property's content we know well enough to judge whether output is genuinely smart or merely plausible. Add the rest once we are trusting the tool rather than checking it.

**Build archetype B first.** It needs no conversion ingest, no GBP surface, and no location dimension — so it exercises the whole spine at the lowest cost. Archetype A is then additive: three new inputs and five new verdicts on top of a spine already proven.

---

## Part 8 — Open Questions

- Which properties are already verified in GSC, and how much history each has. Gates whether step 1 starts from 16 months of data or from zero — and it is the only time-sensitive unknown here.
- Repo location. This document currently sits in the `weekendplant` repo for convenience, but the tool is not part of that project and should not ship inside it — anything living there can never serve the other properties.
- Where the worklist gets read: admin UI, generated markdown report, or both.
- Whether `page_targets` is hand-authored per page or inferred from `ranked_keywords` and confirmed. Hand-authoring 50 pages is fine; 500 is not.
- LLM-visibility tracking via `ai_optimization/llm_mentions` — $0.10/request, ~170× a SERP call. Note this is a *measurement* surface (are we cited in AI answers?), not generation, so it fits the hard-values contract. Still out of scope for v1 on cost grounds.
- Whether `entitySchema` detection needs stemming/synonym lists per vertical, or exact matching is sufficient. Affects how noisy the coverage deltas are.
- Where the pooled expected-CTR curve lives once there are enough properties to compute one — it is the only fact in the system derived from *other* properties' data.

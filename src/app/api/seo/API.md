# SEO Analysis API

Two data endpoints. [`analyze`](#post-apiseoanalyze) measures a page against the pages currently outranking it and returns a flat list of **swaps** — what you have, what the data says to use, and a score for each. [`competitor-queries`](#post-apiseocompetitor-queries) answers the follow-up — what else does that SERP's competition win? — so a caller can loop: analyze, discover, analyze again. The `/seo` admin page's **Discover mode** runs exactly that loop from a bare URL.

Implements Part 4b of [`seo.md`](../../../../seo.md) (the advisory engine) plus the competitor half of Part 1's cold start (steps 4–5, scoped to one SERP). The rest of Parts 1–3 (property intake, GSC ingest, cron detectors) is not built.

(There is also `POST /api/seo/suggest-queries`, the LLM-assisted seed-query helper, documented in its route — it authors candidate input strings and never touches the measured pipeline.)

## Authentication

Same three-principal model as every other gated surface here. Pass the key as either header:

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`

| Principal | Credential | Resolves to |
|---|---|---|
| Session | NextAuth cookie (signed-in browser) | that user |
| Per-user key | `pwsk_<uuid>` | that user |
| Service | the value of `SEO_API_KEY` | `{ userId: null, role: "service" }` |

Missing/wrong key → `401`. Per-surface keys keep blast radius small: a leaked `SEO_API_KEY` unlocks this endpoint and nothing else.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SEO_API_KEY` | yes | Shared server-to-server key for this surface. |
| `DATAFORSEO_LOGIN` | yes | DataForSEO account. Without it the endpoint returns `503` rather than guessing. |
| `DATAFORSEO_PASSWORD` | yes | " |
| `DATABASE_URL` | yes | Already set — the corpus lives in the app's Mongo database. |

---

# The funnel

The endpoints above started page-first: bring a URL and a query, get back how to fix that page. The workspace endpoints below are the **keyword-first** entry point that decides what to point it at.

```
L1  keywords ──────► serp_competitors        → competitor set    ⏸ approve
L2  competitors ───► domain_intersection      → what they win, we don't
                     ranked_keywords (ours)   → striking distance ⏸ approve
L3  candidates ────► difficulty · intent · SERP → winnability     ⏸ approve
L4  finalists ─────► crawl + swaps            → work order
```

**Layers 1–2 are property-scoped; layers 3–4 are page-scoped.** `serp_competitors` and `domain_intersection` both work domain-to-domain, so the competitor set and the gap pile are the same whichever page is being worked. That is what makes working one page at a time cheap: the expensive layers are bought once per property, and every page run afterwards reads them.

**Every layer boundary is a gate.** Nothing advances without a human approving what the previous layer returned.

**Built so far: L1 and its gate.** L2–L4 are not.

## `POST /api/seo/tags`

Register a customer tag — the engagement — and the property it pertains to. Re-posting an existing slug updates its config in place rather than creating a second tag, because `entitySchema` is the field most likely to be refined after seeing real output and a delete/recreate would orphan the run history.

| field | type | required | default | notes |
|---|---|---|---|---|
| `label` | string | yes | — | Human name. `tag` is derived from this when omitted. |
| `domain` | string | yes | — | The property, e.g. `example.com`. Normalized to a host key. |
| `tag` | string | no | from `label` | URL-safe slug, 2–64 chars. Supply it when you want a key independent of display text. |
| `locationCode` | integer | no | `2840` | Inherited by every run under this tag. |
| `languageCode` | string | no | `"en"` | " |
| `entitySchema` | string[] | no | `[]` | As on `analyze` — the highest-leverage field. |
| `urgencyTerms` | string[] | no | `[]` | " |
| `city` | string | no | `null` | " |

`201` with `{ tag: {...} }`. `GET /api/seo/tags` returns `{ tags: [...] }` for the picker.

## `POST /api/seo/runs`

**Layer 1.** A keyword list in, the competitor set out. Creating the run and running layer 1 are one call because there is no gate *before* layer 1 — the keyword list is the input, and a run holding a list and nothing else is a state nobody wants to look at.

This supersedes the competitor half of `competitor-queries`, which picked domains off a *single* SERP. `serp_competitors` ranks domains by overlap across the whole keyword set — breadth no number of single-SERP observations gives you without paying for all of them.

| field | type | required | default | notes |
|---|---|---|---|---|
| `tag` | string | yes | — | Must already exist. Supplies location, language, and config. |
| `keywords` | string[] | yes | — | 1–200. Normalized: trimmed, lowercased, whitespace-collapsed, de-duplicated. Comma-separated string accepted. |
| `minShare` | number | no | `0.1` | Share of the keyword set a domain must cover to count as competition at all. |
| `maxCompetitors` | integer | no | `12` | Kept for approval, after ranking. Capped at 30. |

```jsonc
{
  "run": {
    "runId": "3f2b…", "tag": "weekendplant",
    "keywords": ["cold hardy trees", "zone 3 trees"],
    "status": "competitors_pending",
    "competitors": {
      "rows": [
        { "domain": "thespruce.com", "intersections": 8, "share": 0.8,
          "avgPosition": 4.1, "medianPosition": 3,
          "visibility": 0.41, "estimatedTraffic": 1840 }
      ],
      "capturedAt": "2026-07-28T15:03:58.000Z", "cost": 0.031, "keywordCount": 10
    },
    "approvedCompetitors": null
  },
  "cost": 0.031,
  "observed": 37,        // domains before minShare and the cap trimmed them
  "durationMs": 4210
}
```

**Keyword normalization is load-bearing, not tidiness.** The keyword string is the join key between layer 1's request, layer 2's gap pile, and the routing table. Two spellings of one keyword would silently split that history and make the backlog uncomputable.

`GET /api/seo/runs?tag=<tag>&limit=<n>` returns that tag's lookup history, newest first.

## `GET` / `PATCH /api/seo/runs/[runId]`

`GET` resumes a run — a full funnel run costs a few dollars and spans several minutes across gates, so its state lives in the database rather than in a browser tab.

`PATCH` is **the layer-1 gate**: `{ "domains": ["thespruce.com"] }` records which of the observed competitors layer 2 may run against, and moves the run to `competitors_approved`. Domains layer 1 never returned are dropped rather than failing the request.

**An empty array is a valid answer and is honoured literally.** Someone who reads the competitor set and rejects all of it has said something meaningful; falling back to "then use them all" would spend layer 2's money against an explicit instruction. That is also why `approvedCompetitors` is `null` before the gate rather than `[]` — "not yet decided" and "decided: none" are different states.

| Status | When |
|---|---|
| `404` `RUN_NOT_FOUND` / `TAG_NOT_FOUND` | No such run or tag |
| `409` `COMPETITORS_NOT_READY` | Layer 1 has not returned for this run yet |
| `502` `COMPETITORS_UNAVAILABLE` | Provider returned no usable competitors |
| `503` `COMPETITORS_NOT_CONFIGURED` | Credentials absent — fails closed, like `analyze` |

A vendor failure still **persists the run** in `draft` with its keyword list, so retrying layer 1 is one call rather than a retype.

## `POST /api/seo/runs/[runId]/gaps`

**Layer 2**, and the expensive one — which is what the layer-1 gate is for. Two sources, because they answer opposite questions:

| Source | Bucket | Why |
|---|---|---|
| `domain_intersection`, `intersections: false`, once per approved competitor | `gap` | Keywords they rank for and we don't |
| `ranked_keywords` on our own domain, filtered to position 5–20 | `improve` | We rank, badly — seo.md's striking distance |

`intersections: false` can only ever return keywords we *don't* hold, so "your content could rank better" is unreachable from it. That second call is one extra pull for the highest-ROI bucket in the design.

**This overrules `seo.md` Part 1 step 5**, which says to compute the gap locally by set-differencing two `ranked_keywords` pulls. `ranked_keywords` is row-capped and volume-ordered, so whenever *our* side is truncated the local difference invents gaps that don't exist. The vendor's own mode is definitionally correct at any size.

```jsonc
{
  "run": { "runId": "3f2b…", "status": "gaps_ready", … },
  "added": 312, "refreshed": 88,
  "improveRows": 24, "gapRows": 376,
  "competitors": [
    { "domain": "thespruce.com", "rows": 200, "failed": false },
    { "domain": "gardenia.net",  "rows": 0,   "failed": true }
  ],
  "cost": 0.91, "durationMs": 18240
}
```

**Partial failure is not total failure.** Competitor pulls run concurrently; one that fails contributes nothing and is reported `failed: true` while the rest land. At roughly a dollar-fifty a run, discarding five good pulls because the sixth timed out would be the wrong trade. The layer fails only when *neither* source produced anything.

A property that ranks for nothing yet is not an error — it's `seo.md`'s "coverage building" mode, and the gap half is exactly what it needs.

| Status | When |
|---|---|
| `409` `COMPETITORS_NOT_APPROVED` | The layer-1 gate hasn't been passed |
| `409` `NO_COMPETITORS_APPROVED` | It was passed and everything was rejected — a decision, honoured |
| `502` `NO_GAP_DATA` | Neither competitors nor our own rankings returned anything |
| `503` `GAP_NOT_CONFIGURED` | Credentials absent |

## `GET` / `PATCH /api/seo/tags/[tag]/gaps`

The pile, and its gate. **Hung off the tag, not a run** — layers 1–2 answer a property-level question, so the pile merges across runs and is reviewed where the keywords live.

`GET` accepts `bucket` (`improve` \| `gap`), `status` (`new` \| `accepted` \| `rejected`), `sort`, and `limit`. **It returns the whole pile by default** — the review screen tabs, filters, and sorts client-side over every row, and a cap here means tallies that disagree with the list under them. `total` ships alongside `counts` so a caller that *does* pass a `limit` can tell it was truncated; the rows dropped are always the lowest-volume ones.

Every row carries `opportunityScore`, derived server-side so the screen sorts by the number it prints.

| `sort` | Order |
|---|---|
| `win` (default) | Volume discounted by difficulty, by the evidence that we can take it (our own position for `improve`, holder count for `gap`), and by layer 3's weakness score once it exists |
| `volume` | Raw monthly searches — the check that the scoring hasn't buried something obviously large |

Unscreened rows score **neutral, not zero**, on the weakness factor: not-yet-measured and measured-as-strong are different states, and collapsing them would hide everything layer 3 hasn't reached. Unknown *difficulty* likewise scores as median rather than worst — `domain_intersection` leaves it null on most gap rows, so treating null as hardest would sink the whole bucket for a reason about the vendor rather than the keyword.

`PATCH` takes `{ "keywords": [...], "status": "accepted" }`.

### The merge rule

Re-running layer 2 **updates** the pile; it never replaces it. Each row carries two things no vendor response contains:

- **`status`** — the human's verdict. A refresh next quarter must not resurrect keywords already thrown out.
- **`firstSeenAt`** — how long this has been an opportunity. Not re-derivable once lost.

Facts refresh; decisions and history persist. `mergeAll` reads before it writes for exactly this reason — a blind upsert would be one round trip fewer and would silently destroy both.

A third field, `screening`, follows a variant of the rule: a **fresh** screening wins, an **absent** one preserves what's stored. Layer 3 saves through the same merge, so "always keep the stored one" would discard the call it just paid for.

## `POST /api/seo/tags/[tag]/screen`

**Layer 3** — "eyeball who's weak", made measurable. Runs over **accepted** keywords only; the layer-2 gate is what narrows hundreds of rows to a set worth observing.

Two passes: backfill any null difficulty/intent/volume in one batched `keywords_data` fan-out (one task fee covers up to 1,000 keywords), then observe each SERP and score how soft the incumbents are.

Body is optional: `{ limit, maxSnapshotAgeDays, rescreen }`.

```jsonc
{ "screened": 38, "skipped": 4, "failed": 1, "remaining": 12,
  "fromCorpus": 9, "cost": 0.058, "rows": [ … ], "durationMs": 22140 }
```

### What the score means

Difficulty answers *how hard is it to rank*. Weakness answers **how soft is the page currently there** — and the two disagree often enough to matter. Difficulty 45 against four Reddit threads and three directory listings is a better target than difficulty 30 against seven purpose-built pages. No vendor number expresses that.

| Signal | Weight |
|---|---|
| Forum/UGC share of the top ten | 40 |
| Loose titles — share *not* carrying every significant query term | 40 |
| Directory/aggregator share | 20 |
| AI Overview present | −15 |

Loose titles are weighted as heavily as UGC on purpose: when few results carry the query, Google assembled that page rather than a field of competitors building for it.

**Every operand is stored alongside the score.** It is a sort order backed by visible facts, not a verdict — read `screening.facts` and overrule it. An unscreened keyword returns `screening: null` and sorts last; an unobservable SERP scores `0`, because "not measured" and "measured as strong" must not collapse into the same number.

The UGC and directory domain lists are short and generic. A per-vertical list belongs in tag config and is the obvious thing to make configurable once real output says the default is wrong.

Screening is corpus-first at ~$0.002 a keyword, so re-screening after a rethink is usually free. Runs are capped (40 by default) and report `remaining`.

## `POST` / `PATCH /api/seo/tags/[tag]/route-page`

**Layer 4a**, and the one place a model touches the pipeline. `POST { url }` crawls that page and sorts every accepted keyword against its content:

| Verdict | Condition | The work |
|---|---|---|
| `improve` | We rank for it **with this page**, badly | Fix this page |
| `enrich` | On-topic for this page, but it never says so | Work the terms in |
| `create` | Off-topic for this page | Belongs elsewhere |

**`improve` is never asked.** The vendor already told us which of our URLs holds the ranking; asking a model to re-derive a measured fact would be strictly worse. `improve` rows belonging to a *different* page are excluded rather than routed — a keyword another page owns is not a candidate for this one — and counted in `ownedElsewhere`.

**`create` means "not this page", not "you have no page for this."** We look at one page, so the stronger claim would be unfounded.

### The model's boundary

It classifies topical fit. It never produces a number. Every position, volume, difficulty, and weakness score upstream stays deterministic and diffable. Topical proximity is the one question frequency analysis does badly — *cold hardy trees* against a page titled **Winter Garden Prep** shares no n-grams and is plainly the same subject.

Three defences against a chatty model, all in `reconcileVerdicts`: invented keywords are dropped, unknown verdicts are dropped, and **anything it failed to mention defaults to `create`** — parking a keyword is recoverable, asserting a page should cover something nobody judged is not.

`PATCH { url, keyword, verdict }` corrects one verdict. The correction is marked `overridden` and **survives every later re-route**. That asymmetry is what makes letting a model classify safe: it is allowed to be wrong, because the fix is one click and it sticks.

Page URLs are normalized (`pageKey`) before keying — trailing slashes, query strings, and fragments all describe one page, and four spellings would become four routing histories and silently break the backlog.

## `GET /api/seo/tags/[tag]/backlog`

Accepted keywords **no page run has ever claimed** — where "claimed" means routed `improve` or `enrich` by any page. A `create` verdict is explicitly not a claim.

```jsonc
{ "rows": [ … ],
  "coverage": { "pagesRouted": 12, "keywordsClaimed": 47, "keywordsAccepted": 89 } }
```

One page declining a keyword says almost nothing. After twenty pages the residue is the property's real coverage gap — found without ever crawling the site, because the routing table accumulated it.

**`coverage.pagesRouted` ships with every response and is not optional.** After three pages the list is mostly "we haven't looked yet"; presenting it as a finding would be the same dishonesty as returning a fabricated number for something never measured. The UI says so in words below ten pages.

## `POST /api/seo/work-order`

**Layer 4b** — the last mile. `{ analysisId, refresh? }` turns a stored run's swaps into the sentence `seo.md` set as the target: *"I need to reword this, this post needs adjusting in these ways, and we need X, Y, Z for meta tags and JSON-LD."*

`analyze` now returns `analysisId` (absent only when the best-effort history write failed), so a run can be written up straight after it completes or any time later from history.

```jsonc
{ "analysisId": "…", "url": "…", "query": "cold hardy trees",
  "workOrder": {
    "headline": "Rewrite the title around 'cold hardy'.",
    "items": [ { "area": "title", "action": "Lead the title with…",
                 "evidence": "8 of 10 ranking pages use it.", "leverage": 72 } ],
    "titleOptions": ["23 Cold Hardy Trees for Zone 3 Gardens"],
    "metaOption": "Which trees survive northern winters? …",
    "rendererVersion": "1.0.0", "model": "gpt-5.4-mini", "renderedAt": "…"
  },
  "cached": false }
```

**No vendor cost.** It reads a run already paid for — no SERP, no crawl, no keyword call. Re-rendering is tokens only, which is why the result is cached rather than persisted as truth, and why `refresh: true` is offered openly.

**This is where the engine's `signals` contract pays off.** The engine emits term frequencies, structural patterns, median lengths, and verbatim competitor titles precisely because *"any consumer with a model will write something better from the raw signals than our template could."* This is that consumer. The `titleOptions` here are the prose the engine refuses to write, and they are built from `signals.examples[]`.

### What the model may not do

- **An item for an area the brief never contained is dropped.** The brief is built deterministically from the swaps, so the model cannot invent work the measurements never supported. That is the one hallucination that survives moving the model to the edge, and `parseWorkOrder` is where it dies.
- **`leverage` comes from the swap, never from the model.** It is arithmetic the engine already did; re-asking for it would let prose reorder a measured ranking. Items are sorted by it, not by the order the model returned them.
- **A page with nothing worth changing gets `409 NOTHING_TO_DO`**, not prose padded out to look useful.

A cached rendering from an older `rendererVersion` is ignored and rewritten — the stamp exists so a stale rendering is recognizable rather than silently authoritative.

---

## `POST /api/seo/analyze`

**Request — `application/json`**

| field | type | required | default | notes |
|---|---|---|---|---|
| `url` | string | yes | — | Absolute `http(s)` URL of the page to analyze. We crawl it; it must be publicly reachable and return HTML. |
| `targetQuery` | string | yes | — | The query this page is meant to win. |
| `locationCode` | integer | no | `2840` | DataForSEO numeric location code. `2840` = United States. |
| `languageCode` | string | no | `"en"` | ISO-639-1. |
| `entitySchema` | string[] | no | `[]` | The fact *types* a good page in this vertical states — e.g. `["hardinessZone","matureHeight","sunRequirement"]`. **The highest-leverage field in the request:** it defines what "complete coverage" means for the `facts` area. Accepts a comma-separated string too. |
| `urgencyTerms` | string[] | no | `[]` | Vertical vocabulary counted as a title pattern — e.g. `["emergency","24/7","same day"]`. |
| `city` | string | no | `null` | Locale token for archetype-A title composition counts (`containsCity`). |
| `minShare` | number | no | `0.3` | Share of competitors that must use a feature before it is *recommended*. In `(0, 1]`. Echoed back in `thresholds`. |
| `maxSnapshotAgeDays` | number | no | `7` | Reuse a stored SERP this fresh instead of re-observing. `0` forces a live SERP call. |
| `include` | string[] | no | `[]` | Optional response sections: `provenance`, `history`, `serp`, `facts`, `keywords`. None appear by default. |

Unknown top-level fields are ignored, so adding options later never breaks a caller.

**Response — `200 application/json`**

```jsonc
{
  "url": "https://weekendplant.com/garden-skills/trees-of-the-north",
  "query": "cold hardy trees",
  "location": "2840",
  "analyzedAt": "2026-07-22T15:04:11.482Z",
  "formulaVersion": "1.0.0",

  "swaps": [
    {
      "area": "title",
      "current": "Trees of the North",
      "currentScore": 12,
      "suggestedScore": 84,
      "signals": {
        "terms": [
          { "term": "cold hardy", "in": 8, "of": 10 },
          { "term": "zone",       "in": 8, "of": 10 }
        ],
        "patterns": [
          { "term": "leadsWithCount", "in": 7, "of": 10 }
        ],
        "lengthMedian": 54,
        "examples": [
          "23 Cold Hardy Trees for Zone 3 Gardens",
          "Best Cold Hardy Trees: Zone 2-5 Varieties"
        ]
      }
    },
    {
      "area": "facts",
      "current": ["hardinessZone"],
      "currentScore": 25,
      "suggested": ["matureHeight", "sunRequirement", "soilType"],
      "suggestedScore": 100
    }
  ],

  "thresholds": { "minShare": 0.3, "maxSnapshotAgeDays": 7 },
  "sample": {
    "competitors": 9,
    "crawled": 7,
    "crawlFailures": 2,
    "serpCapturedAt": "2026-07-22T15:03:58.000Z",
    "serpFromCorpus": false,
    "ourPosition": 8,
    "features": ["ai_overview", "people_also_ask"]
  },
  "durationMs": 21874
}
```

Swaps are **sorted by `suggestedScore - currentScore`**, so the first row is the highest-leverage change.

### Areas

| Area | Answers | Shape |
|---|---|---|
| `title` | What to call it | `signals` |
| `meta` | What the snippet should say | `signals` |
| `headings` | What sections to have | `suggested` |
| `facts` | Which fact *types* to state — from `entitySchema` | `suggested` |
| `entities` | Which specific *items* to name | `suggested` |
| `questions` | Which questions to answer | `suggested` |
| `schema` | What to mark up (full end state, additive) | `suggested` |
| `links` | How many internal links out | `suggested` |
| `length` | How long it should be | `suggested` |

An area is **omitted entirely** when nothing was observed for it — a zero score would claim a measurement we never made. If every competitor blocks the crawler you still get `title` and `meta` (measured from the SERP itself); the body-derived areas disappear and `sample.crawled` tells you why.

**Two shapes, deliberately:**

- **`suggested`** — the observed competitor data *is* the answer: a set to adopt.
- **`signals`** — `title` and `meta` only. Raw ingredients: term frequencies, structural patterns, median length, and verbatim competitor examples. **There is no `suggested` string for prose, by design.** We never write copy the caller ships; any consumer with a model will write something better from the signals than a template could. `suggestedScore` is still emitted so you can score your own rewrite against it.

`examples[]` is the highest-value field for an AI consumer — verbatim titles and metas from the pages currently ranking.

### Scoring

> **Score = the percentage of observed competitive features you match, weighted by how many competitors use each.**

- `currentScore` — what the page already matches.
- `suggestedScore` — what it would match after adopting every *recommended* feature (those at or above `minShare`).

Features below `minShare` stay in the denominator but are never recommended, which is why a suggested score lands in the eighties rather than at 100: the long tail of things one or two competitors do is observable, reported, and deliberately not something we tell you to chase. Numeric areas (`links`, `length`) score by distance from the observed median, so adopting the median scores 100.

Every threshold is echoed in `thresholds`. A consumer who disagrees can ignore our scores and re-derive from the raw facts via `include=facts,provenance`.

### `include` sections

| Value | Adds |
|---|---|
| `provenance` | `swaps[].provenance` — every feature considered, with its `in`/`of`, not just the recommended ones. |
| `serp` | `serp` — the full fact family 2: all frequency tables, spreads, questions, features. |
| `facts` | `facts.page` (what we measured on your page) and `facts.delta` (the raw set differences). |
| `keywords` | `keywords` — volume, CPC, competition, difficulty, intent, and up to 4 years of monthly history for the target query. |
| `history` | `history` — derived from our own stored observations (below). |

### History facts

`include=history` adds values nobody who wasn't recording can compute:

```jsonc
"history": {
  "serpVolatility90d": { "value": 0.31, "observations": 12, "required": 3 },
  "top10Churn": { "value": { "entered": ["c.com"], "exited": ["b.com"], "spanDays": 14 },
                  "observations": 12, "required": 2 },
  "termStability": { "value": 0.83, "observations": 12, "required": 6 },
  "observations": 12
}
```

Below the observation floor a fact returns an explicit null **with its reason** — never a fabricated or defaulted number:

```jsonc
"serpVolatility90d": { "value": null, "reason": "insufficient_history",
                       "observations": 1, "required": 3 }
```

Day-one output stays honest; year-two output is genuinely better.

---

## `POST /api/seo/competitor-queries`

The Discover loop's second step. Given a page and the query it was just analyzed for, it looks at who occupies that SERP, pulls what those domains rank for (`dataforseo_labs/google/ranked_keywords`, corpus-first), and returns the on-topic, page-one queries they win that you haven't analyzed yet — ranked as your next `analyze` targets.

**No LLM here either.** Selection is a pure function of measured facts: a suggestion must share at least half its content words with your page, a competitor's own brand queries are dropped, the target and `excludeQueries` are never re-suggested, and a query several competitors hold outranks one site's fluke. The score is the same explicit demand/winnability heuristic the suggest helper uses, plus a breadth term — every operand is returned so you can overrule it.

**Request — `application/json`**

| field | type | required | default | notes |
|---|---|---|---|---|
| `url` | string | yes | — | Same crawl rules as `analyze`. Relevance is measured against this page. |
| `targetQuery` | string | yes | — | The query whose SERP defines "the competition" — usually the one just analyzed, so the SERP is a free corpus hit. |
| `locationCode` | integer | no | `2840` | As on `analyze`. |
| `languageCode` | string | no | `"en"` | As on `analyze`. |
| `maxCompetitors` | integer | no | `4` | Distinct SERP domains to pull rankings for, best positions first. Capped at 6. |
| `maxSuggestions` | integer | no | `10` | Capped at 20. |
| `excludeQueries` | string[] | no | `[]` | Queries already analyzed this session. Comma-separated string accepted. |
| `maxSnapshotAgeDays` | number | no | `7` | SERP freshness, as on `analyze`. The rankings themselves reuse a 90-day window — seo.md refreshes them quarterly. |

**Response — `200 application/json`**

```jsonc
{
  "url": "https://weekendplant.com/garden-skills/trees-of-the-north",
  "targetQuery": "cold hardy trees",
  "location": "2840",
  "analyzedAt": "2026-07-23T15:04:11.482Z",

  "suggestions": [
    {
      "query": "hardy trees zone 3",
      "score": 78,                    // demand + winnability + breadth, 0–100
      "searchVolume": 1900,
      "difficulty": 21,
      "intent": "informational",
      "competitorCount": 3,           // pulled domains holding page-one positions
      "bestPosition": 2,
      "domains": ["arborday.org", "thespruce.com", "gardenia.net"]
    }
  ],

  "competitors": [
    { "domain": "arborday.org", "serpPosition": 2, "keywordsSampled": 100,
      "totalKeywords": 48200, "fromCorpus": false, "failed": false }
  ],

  "sample": {
    "serpCapturedAt": "2026-07-23T15:03:58.000Z",
    "serpFromCorpus": true,
    "competitorsRequested": 4,
    "competitorsWithData": 4
  },
  "durationMs": 9421
}
```

A single failed domain never fails the request — it comes back `failed: true`, contributes nothing, and shrinks `competitorsWithData`. Suggestions are sorted by `score`, ties toward more competitors, then lower difficulty.

---

## Errors

Shared by both endpoints:

| Status | When | Body |
|---|---|---|
| `400` | Malformed JSON, or a field failed validation | `{"error": "Invalid request.", "fields": [{"field": "url", "message": "..."}]}` — every failure names its field |
| `401` | Missing/wrong API key | `{"error": "Unauthorized"}` |
| `422` | `PAGE_UNREACHABLE` — your URL timed out, wasn't HTML, or resolved to a private address | `{"error": "...", "code": "PAGE_UNREACHABLE"}` |
| `502` | `SERP_UNAVAILABLE` — the SERP provider returned nothing usable | `{"error": "...", "code": "SERP_UNAVAILABLE"}` |
| `503` | `SERP_NOT_CONFIGURED` — DataForSEO credentials absent. Fails closed: a sheet built from page facts alone would look like an answer while being a guess | `{"error": "...", "code": "SERP_NOT_CONFIGURED"}` |
| `500` | Unexpected fault | `{"error": "<message>"}` |

`competitor-queries` only:

| Status | When | Body |
|---|---|---|
| `502` | `NO_COMPETITOR_DATA` — every domain pull failed, or the SERP held nobody but you | `{"error": "...", "code": "NO_COMPETITOR_DATA"}` |
| `503` | `RANKED_KEYWORDS_NOT_CONFIGURED` — the SERP came from the corpus but the provider credentials are absent | `{"error": "...", "code": "RANKED_KEYWORDS_NOT_CONFIGURED"}` |

## Example

```bash
curl -X POST https://jawetzel.com/api/seo/analyze \
  -H "X-API-Key: $SEO_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://weekendplant.com/garden-skills/trees-of-the-north",
    "targetQuery": "cold hardy trees",
    "entitySchema": ["hardinessZone","matureHeight","sunRequirement","soilType"],
    "include": ["history"]
  }'
```

---

## What these endpoints do not do

Stated plainly, because each one looks like it might. (The body-measurement bullets are about `analyze`; the first applies to both.)

- **No LLM, anywhere.** The tool consumes, records, and emits measured facts. Every output is a pure function of stored inputs — reproducible, diffable month over month, no hallucination surface. Wording is your job. (`suggest-queries` is the one LLM-touched helper, and it only authors *input* strings.)
- **No prose.** See the `signals` shape above.
- **No inbound-link count.** `seo.md` scopes the `links` area to *inbound* internal links, which needs a site-wide crawl; this endpoint fetches exactly one URL of yours. What it reports is internal links **out**, measured the same way across the crawled top 10.
- **No GSC data.** Clicks, impressions, CTR deficit, and position trend need a Search Console connection that is not built. Those fact-family-4 fields are simply absent, never zero.
- **No rich-result promise.** Google removed HowTo rich results entirely and restricted FAQ rich results to authoritative gov/health sites. The `schema` area earns machine-readability and entity clarity — not SERP decoration.

## Timing and cost

One `analyze` request = one live SERP call (skipped on a corpus hit) + up to 11 page fetches at concurrency 5, each with a 12s timeout. Expect **10–40s**; the route allows 120.

One `competitor-queries` request = one page fetch + a SERP only on a corpus miss + up to `maxCompetitors` ranked-keywords pulls in parallel (skipped for domains observed within 90 days). Expect **5–20s**.

A live SERP is ~$0.002, keyword metrics ~$0.12 per batch, and a ranked-keywords pull roughly $0.10–0.20 per domain — all read off the vendor response rather than hardcoded. Repeat calls inside the freshness windows cost nothing. A full Discover run from the admin page (seed suggestion + 4 analyses + 4 competitor pulls) lands around **$1–1.50** cold, less as the corpus fills.

## Storage

Every request writes to the corpus (`seo.md` Part 4). Nothing is ever deleted — there is no TTL index and no pruning job.

| Collection | Key | Pools across callers? |
|---|---|---|
| `seo_serp_snapshots` | `(query, location, capturedAt)`, append-only | **Yes** — nobody owns what ranks for a query |
| `seo_keyword_metrics` | `(query, location)`, upserted | **Yes** |
| `seo_ranked_keywords` | `(target, location, capturedAt)`, append-only | **Yes** — what a domain ranks for is public observation too |
| `seo_page_snapshots` | `(propertyId, url, capturedAt)`, written only when the content hash changes | **No** — your content, `propertyId` = the URL's host |
| `seo_tags` | `(tag)`, upserted | **No** — the workspace |
| `seo_runs` | `(runId)`, upserted | **No** — " |
| `seo_gap_keywords` | `(tag, keyword)`, **merged** | **No** — carries the human's verdicts |
| `seo_routings` | `(tag, pageUrl, keyword)`, upserted | **No** — never pruned; the backlog is set math over all of it |

That pooling is the flywheel: more callers → more queries observed → better volatility and trajectory facts for everyone. The line is drawn in the collection keys, not in a policy document.

The workspace collections are the exception to "nothing is ever deleted": they are *mutable working state*, edited in place as a run advances through its gates. Nothing perishable is overwritten — every observation a run captured is already append-only in the corpus.

### Where the model is allowed

The old "no LLM, anywhere" line is retired; the replacement is narrower and more useful — **models at the edges, determinism in the middle.**

| Zone | Model? | Endpoint |
|---|---|---|
| Input authoring | yes | `suggest-queries` |
| **Measured engine** | **never** | `analyze`, `competitor-queries`, `runs`, `gaps`, `screen` |
| Classification | yes | `route-page` — topical fit only, never a number |
| Rendering | yes | `work-order` — prose over stored swaps, never a number |

**The model classifies and writes; it never measures.** Every guarantee that mattered — reproducible, diffable, unit-testable with exact assertions — was always a property of the engine rather than of the API, and all of it survives. Both model-touched endpoints validate their output against the measurements they were given, so neither can assert work the engine never supported.

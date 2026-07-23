# SEO Analysis API

One endpoint. It measures a page against the pages currently outranking it and returns a flat list of **swaps** — what you have, what the data says to use, and a score for each.

Implements Part 4b of [`seo.md`](../../../../seo.md) (the advisory engine). Parts 1–3 (cold start, GSC ingest, cron detectors) are not built.

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

## Errors

| Status | When | Body |
|---|---|---|
| `400` | Malformed JSON, or a field failed validation | `{"error": "Invalid request.", "fields": [{"field": "url", "message": "..."}]}` — every failure names its field |
| `401` | Missing/wrong API key | `{"error": "Unauthorized"}` |
| `422` | `PAGE_UNREACHABLE` — your URL timed out, wasn't HTML, or resolved to a private address | `{"error": "...", "code": "PAGE_UNREACHABLE"}` |
| `502` | `SERP_UNAVAILABLE` — the SERP provider returned nothing usable | `{"error": "...", "code": "SERP_UNAVAILABLE"}` |
| `503` | `SERP_NOT_CONFIGURED` — DataForSEO credentials absent. Fails closed: a sheet built from page facts alone would look like an answer while being a guess | `{"error": "...", "code": "SERP_NOT_CONFIGURED"}` |
| `500` | Unexpected fault | `{"error": "<message>"}` |

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

## What this endpoint does not do

Stated plainly, because each one looks like it might.

- **No LLM, anywhere.** The tool consumes, records, and emits measured facts. Every output is a pure function of stored inputs — reproducible, diffable month over month, no hallucination surface. Wording is your job.
- **No prose.** See the `signals` shape above.
- **No inbound-link count.** `seo.md` scopes the `links` area to *inbound* internal links, which needs a site-wide crawl; this endpoint fetches exactly one URL of yours. What it reports is internal links **out**, measured the same way across the crawled top 10.
- **No GSC data.** Clicks, impressions, CTR deficit, and position trend need a Search Console connection that is not built. Those fact-family-4 fields are simply absent, never zero.
- **No rich-result promise.** Google removed HowTo rich results entirely and restricted FAQ rich results to authoritative gov/health sites. The `schema` area earns machine-readability and entity clarity — not SERP decoration.

## Timing and cost

One request = one live SERP call (skipped on a corpus hit) + up to 11 page fetches at concurrency 5, each with a 12s timeout. Expect **10–40s**; the route allows 120.

A live SERP is ~$0.002 and keyword metrics ~$0.12 per batch, both read off the vendor response rather than hardcoded. Repeat calls for the same `(query, location)` inside `maxSnapshotAgeDays` cost nothing.

## Storage

Every request writes to the corpus (`seo.md` Part 4). Nothing is ever deleted — there is no TTL index and no pruning job.

| Collection | Key | Pools across callers? |
|---|---|---|
| `seo_serp_snapshots` | `(query, location, capturedAt)`, append-only | **Yes** — nobody owns what ranks for a query |
| `seo_keyword_metrics` | `(query, location)`, upserted | **Yes** |
| `seo_page_snapshots` | `(propertyId, url, capturedAt)`, written only when the content hash changes | **No** — your content, `propertyId` = the URL's host |

That pooling is the flywheel: more callers → more queries observed → better volatility and trajectory facts for everyone. The line is drawn in the collection keys, not in a policy document.

# Workers & deployment

> Target framing. Behavior is unchanged — see [`overview.md`](overview.md) for
> status. There are **two** independent background systems with totally
> different deploy paths. Keeping them straight matters; they are not a unified
> job queue and the docs don't pretend otherwise.

## 1. In-process cron — `src/worker/`

A `node-cron` scheduler that runs **inside the Next.js server process**.

- **Started by `src/instrumentation.ts`**, and only when both hold:
  `NEXT_RUNTIME === "nodejs"` **and** the deployment looks like prod
  (`NEXTAUTH_URL` set and not `localhost`). Dev never spawns crons. This gate is
  the whole "don't run background jobs in dev" policy — one place.
- **`startWorker()`** (`src/worker/index.ts`) registers two jobs, both on
  `America/New_York` (IANA zone, so DST is automatic) and both guarded by a
  module-level `shuttingDown` flag; `SIGTERM`/`SIGINT` flip it and exit after a
  5s grace.

| Job | Schedule | Does |
| --- | --- | --- |
| `runRefreshEmbroiderySupplies` | `0 6,20 * * *` (6 AM & 8 PM ET) | Pull every vendor catalog → compile → write to R2 |
| `runIndexNowPing` | `30 4 * * 3` (Wed 4:30 AM ET) | Ping IndexNow with the site URL list |

### The supply-feed refresh

`jobs/refresh-embroidery-supplies.ts` runs each `jobs/sources/<vendor>-pull.ts`
(Gunold, Sulky, AllStitch, Madeira, Hab+Dash, ColDesi, ThreadArt, OhMyCrafty),
writing `supplies/<vendor>/current.json` + a dated archive to R2, then
`jobs/compile-feeds.ts` merges them into the canonical
`supplies/products/current.json`, `supplies/listings/current.json`, and a CSV.
A mutual-exclusion flag prevents overlapping runs. The compiled feed is what
`/tools/embroidery-supplies`, the `find_thread_color` chat tool, and the
download endpoints read back (cached via `cache.ts`).

> An in-flight schema split (Product vs Listing — `brand`/`product_line`/
> `material` replacing the older `manufacturer`/`vendor` muddle) is tracked in
> the repo-root `embroidery-refactor.md`. That is a *data-shape* refactor,
> separate from this architecture work.

### Target

The scheduler is just another **driving adapter** — cron is a driver, like an
HTTP route. `startWorker()` should resolve and invoke **scheduled use-cases**
(`RefreshSupplyFeeds`, `PingIndexNow`) from the container; each vendor pull
becomes an adapter behind a `SupplyFeedSource` port. Payoff: `RefreshSupplyFeeds`
becomes unit-testable with fake feed sources + a fake `ObjectStore`, with no
cron, no network, and no 6-AM wait — today its logic is reachable only by
running the job for real.

> **Status:** the **`PingIndexNow`** half is migrated (the first worker
> sub-slice) — it's now a use-case in the container behind two driven ports
> (`IndexNowLog` → `MongoIndexNowLog` wrapping `lib/indexnow-tracker`,
> `IndexNowSubmitter` → `HttpIndexNowSubmitter` wrapping `lib/indexnow`), and
> `runIndexNowPing` shrank to a thin `createContainer().pingIndexNow.execute()`
> wrapper so the schedule/timezone/guards in `index.ts` are unchanged. The
> `RefreshSupplyFeeds` half is mostly still flat, but its **vendor-source edge is
> migrated**: the 7 active vendor pulls now sit behind a `SupplyFeedSource` port
> (one adapter per vendor in `infrastructure/supply-feed/`, each wrapping the
> unchanged `jobs/sources/<vendor>-pull` parser, wired DB-free in
> `composition/supply-feed.ts`), and the orchestrator builds its `VENDORS` list
> from `getSupplyFeedSources()`. The orchestration itself — the mutual-exclusion
> flag, the R2 read-back compile, the options/failure handling — stays flat for
> the next sub-slice. See [`migration.md`](migration.md) → *Progress*.

## 2. The Python embroidery microservice — `worker/`

A **separate container**, **separate Railway service**, that does the heavy image
→ stitch computation. The Next.js app is a *client* of it.

- **Stack:** Debian + Inkscape + Potrace + Inkstitch + pyembroidery, served by
  **Gunicorn with `uvicorn` workers** (`worker/Dockerfile`, `worker/main.py` ≈
  3200 lines). FastAPI-style endpoints — `/trace`, `/convert`, `/sample-colors`
  — consumed from TypeScript by `src/app/embroidery/_lib/worker.ts`
  (`traceImage`, `convertSvg`, `sampleColors`). The `/tools/image-to-svg` tool
  also calls it.
- **Concurrency:** `WORKERS` (default 4) OS processes, each an
  `asyncio.Semaphore(1)` → one in-flight job per worker, returning **HTTP 503**
  on overload, which Next.js surfaces as **429**. `--timeout 1800` (dense designs
  can exceed 15 min), `--max-requests 50` to bound RSS drift, `--preload` +
  `gc.freeze()` for copy-on-write memory sharing across forks (memory is billed).
- **`--bind [::]:$PORT` (IPv6).** Railway's private network is **IPv6-only**
  (`*.railway.internal` is AAAA-only); binding to IPv4 `0.0.0.0` makes the worker
  silently unreachable from sibling services. Dual-stack Linux still accepts IPv4
  so local `docker run -p` works. *(See the Railway IPv6 memory note.)*

### Target

The Python service is an external **driven actor**. Put an
`EmbroideryComputeGateway` port in front of it; `_lib/worker.ts` becomes
`HttpEmbroideryWorker implements EmbroideryComputeGateway`. The
`RunEmbroideryPipeline` use-case ([`embroidery.md`](embroidery.md)) then depends
on the *capability* (trace / convert / sample), and can be tested against a fake
that returns canned SVG/zip bytes — no Docker, no Inkstitch, no HTTP. **The
service's own code and behavior are out of scope; only the TS client moves.**

## Deployment shape

- **Web app:** Railway Web Service, built by **Railpack from the repo root**
  (`output: "standalone"`). The in-process cron rides along inside it. **Single
  replica** today — which is why the in-memory caches and magic-link store are
  acceptable (see [`auth.md`](auth.md), [`external-services.md`](external-services.md)).
- **Python worker:** separate Railway service from `worker/Dockerfile`, built
  with the **repo root as context** (hence the `worker/`-prefixed `COPY` paths).
- **`.dockerignore` (repo root) is shared** by both builds. It must stay
  **additive** (exclude bloat: `node_modules`, `.next`, `tmp`, `data`, `.git`,
  …). Do **not** use `*` + `!worker/` — that hides `src/` from the Next.js build
  context and breaks `next build`. *(See the Railpack `.dockerignore` memory
  note.)*

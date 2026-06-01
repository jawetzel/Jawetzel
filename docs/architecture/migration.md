# Migration map — current flat layout → target

> **Status: in progress.** The refactor is **underway**, executed **one vertical
> user-action slice at a time**. Each slice is behavior-preserving and lands
> green (typecheck + `npm test`). This file is both the map (current → target)
> and the **running log** (see *Progress* at the bottom). Un-migrated code stays
> flat and working until its slice comes up.

The goal of the move is the four properties in [`overview.md`](overview.md) —
testability, layer separation, separation by actor, dependency inversion — with
**identical runtime behavior**. Same routes, same endpoints, same rendered
output, same data.

## Strategy: vertical slices (not horizontal layers)

The execution order is **by user action**, not by layer. Rather than "extract
all domain types, then all ports, then all adapters" (the layer-at-a-time plan
sketched under *Suggested sequencing* below), each unit of work takes a single
user-facing action all the way down — domain value object → consumer-owned port
→ infrastructure adapter → application use-case → rewired thin driving adapter →
unit test against fakes — and leaves every other path untouched. Why:

- **Each slice is independently shippable and reviewable** (one commit, one
  endpoint's worth of behavior to verify).
- **Interfaces are consumer-defined.** A port is created by the use-case that
  needs it, shaped to that need — not designed up front as a guess. The
  `EmailSender` port exposes exactly what `SubmitContactInquiry` calls, nothing
  more.
- **Files are removed only when their last consumer leaves.** Shared `src/lib/*`
  helpers (e.g. `email.ts`, still used by magic-link + embroidery) shrink as
  slices migrate and are deleted when the final workflow moves off them. The
  flat layer dissolves incrementally, not in one cut.

The current → target table below stays the reference for *where each piece
lands*; the slice order is driven by risk and dependency, lowest-risk first.

## The shape today

Flat, pragmatic, and working:

```
src/
  app/              Next routes, route handlers, server actions  (driving adapters — already)
  components/       UI: flat feature components + ui/ primitives + chat/
  content/          JSON/Markdown content (projects, testimonials, marquee, resume, changelog)
  data/             thread color maps / crossmatch (dev scratch — see memory)
  lib/              EVERYTHING ELSE: content getters, mongo, auth, r2, ai, email, sms, cache, seo…
  types/            user.ts, next-auth.d.ts
  worker/           in-process node-cron jobs + vendor feed pulls
  instrumentation.ts  starts the cron worker in prod
blog/               blog posts (JSON) — repo root, not src/
worker/             separate Python embroidery microservice (Dockerfile + main.py)
```

The pressure point is `src/lib/` — it is a single bucket mixing three target
layers: pure types (`ProjectCaseStudy`, `BlogPost`, `User`), orchestration
(content getters, the chat loop, the embroidery pipeline), and technology
adapters (`mongodb.ts`, `r2.ts`, `email.ts`, `sms.ts`, `ai/client.ts`). The
refactor's main job is to pull those three apart.

## Current → target mapping

| Current location | Target layer / role | Notes |
| --- | --- | --- |
| `src/app/**/page.tsx` | `app/` **driving adapter** (Server Component) | Already thin-ish; move remaining logic into use-cases. |
| `src/app/api/**/route.ts` | `app/` **driving adapter** (Route Handler) | The public tool APIs; share use-cases with the UI pages. |
| Server Actions (form posts) | `app/` **driving adapter** | Same parse → use-case → render contract. |
| `ProjectCaseStudy`, `BlogPost`, `User`, `Generation`, `Thread` types | `domain/` entities / value objects | Today inlined in their getter/adapter files. |
| `validateSize`, `validateCustomerId`, color clamps | `domain/` value-object construction | Already invariant-at-construction — the model's seed. |
| `src/lib/projects.ts`, `blog.ts`, `testimonials.ts`, `marquee.ts`, `resume.ts` | `application/` use-cases + `infrastructure/` FS reader behind `ContentSource` | The FS read is the adapter; the shaping/sorting is the use-case. |
| `src/lib/mongodb.ts` | `infrastructure/mongo` singleton client | Already a stateless singleton — keep as-is, inject it. |
| `src/lib/users.ts` | `infrastructure/mongo/MongoUserRepository` + `application/` use-cases | Behind `UserRepository`. |
| `src/lib/auth.ts`, `magic-link.ts` | `infrastructure/auth` + `application/` use-cases | Behind `SessionGateway` / identity ports. See [`auth.md`](auth.md). |
| `src/lib/api-auth.ts` | `application/` use-case (`AuthenticateRequest`) + adapters | The three-path resolver is a use-case; key hashing is an adapter concern. |
| `src/lib/r2.ts` | `infrastructure/object-store/R2ObjectStore` behind `ObjectStore` | `dev_` prefix is an adapter detail. See [`external-services.md`](external-services.md). |
| `src/lib/email.ts`, `sms.ts` | `infrastructure/messaging/Brevo*` behind `EmailSender` / `SmsSender` | |
| `src/lib/ai/client.ts` | `infrastructure/llm/OpenAiChatGateway` behind `LlmGateway` | **Done** — deleted; the adapter is the sole `openai` importer. |
| `src/lib/ai/chat.ts`, `ai/conversations.ts` | `application/` chat use-cases (`RunAssistantTurn` / `SummarizeConversationTitle`) + `LlmGateway` / `ConversationStore` ports | **Done** — the loop is orchestration; the two writes are a port. `chat.ts` is a thin wrapper; the *read* side of `conversations.ts` stays flat in the routes. |
| `src/lib/ai/tools/*` | `application/` use-cases invoked by the tool dispatcher | Tools must call use-cases via ports, never inline I/O. See [`external-services.md`](external-services.md). |
| `src/lib/cache.ts` | `infrastructure/cache/MemTtlCache` behind `Cache` | |
| `src/lib/rate-limit.ts` | `infrastructure` behind `RateLimiter` | |
| `src/lib/seo.ts`, `jsonld.tsx`, `sitemap-dates.ts`, `indexnow*.ts` | mixed: pure helpers → `domain`/shared; pings → `application` use-case + adapter | |
| `src/worker/index.ts` | thin **scheduler driving adapter** | Cron is just another driver of use-cases. See [`worker.md`](worker.md). |
| `src/worker/jobs/*` | `application/` scheduled use-cases | `RefreshSupplyFeeds`, `PingIndexNow`. |
| `src/worker/jobs/sources/*-pull.ts` | `infrastructure/` adapters behind `SupplyFeedSource` | One adapter per vendor. |
| `worker/` (Python) | external **driven adapter** behind `EmbroideryComputeGateway` | The service itself is unchanged; only the TS client moves. See [`worker.md`](worker.md). |
| `src/app/embroidery/_lib/worker.ts` | `infrastructure/` HTTP adapter (`HttpEmbroideryWorker`) | Implements `EmbroideryComputeGateway`. |
| `src/app/embroidery/_lib/pipeline.ts` | `application/` use-case (`RunEmbroideryPipeline`) | See [`embroidery.md`](embroidery.md). |
| `src/app/embroidery/_lib/geometry/*` | pure libs → `domain` (**done** — now `domain/embroidery/geometry/*`) | Pure SVG path math; no I/O. |
| `src/app/embroidery/_lib/inkstitch/*` | pure libs → `domain`-adjacent (**deferred** — fragile `.gpl` load) | `apply-attrs`/`thread-palette` are pure; `gpl-palette` does the bundled `.gpl` `readFileSync` via `new URL(..., import.meta.url)`. |
| `src/app/embroidery/_lib/ai/*` | `application/` + `LlmGateway` | `select-palette`, `tag-svg` call OpenAI via the gateway. |
| `src/app/embroidery/_lib/auth.ts`, `quota.ts` | `application/` use-cases | Per-surface auth + quota. |
| `src/components/*.tsx` (flat) | `features/<feature>/` slices | chat, embroidery, contact, auth groupings. |
| `src/components/ui/*`, `src/components/chat/*` | `components/ui/` primitives + `features/chat/` | `ui/` already correct; chat already a near-slice. |
| `src/content/*`, `blog/` | content data (unchanged) | Read through `ContentSource`; consider unifying `blog/` under `src/content/`. |

## Suggested sequencing (when the refactor runs)

Lowest-risk first; each step is independently shippable and leaves the app green.

1. **Extract domain types.** Move the interfaces (`ProjectCaseStudy`, `BlogPost`,
   `User`, `Generation`, `Thread`, the embroidery value objects) into `domain/`.
   Pure type moves — zero behavior risk.
2. **Define ports** in `application/ports/` for the table above. No call sites
   change yet; this is just declaring the interfaces the adapters already satisfy.
3. **Wrap existing modules as adapters.** `mongodb.ts`, `r2.ts`, `email.ts`,
   `sms.ts`, `ai/client.ts`, the vendor pulls, the Python HTTP client — rename/
   relocate under `infrastructure/` and have each `implements` its port. Bodies
   barely change; they already do exactly this work.
4. **Lift orchestration into use-cases.** The content getters, the chat loop, the
   embroidery pipeline, the cron jobs — move into `application/`, taking ports as
   constructor deps. This is where testability lands: each use-case now runs
   against fakes.
5. **Introduce `createContainer(ctx)`** in `composition/` and have the driving
   adapters (`app/`, `worker/index.ts`) resolve use-cases from it.
6. **Slice the client** into `features/<feature>/`; leave `components/ui/` as-is.
7. **Backfill tests** at each layer as the seams appear — this is the payoff, not
   an afterthought.

Steps 1–3 are nearly mechanical and carry almost no behavior risk; 4–6 are where
judgment is needed. Stop and reassess after step 3 — much of the
dependency-inversion and testability benefit is already realized there.

## What this refactor explicitly does **not** do

- Change any route, endpoint, response shape, or rendered output.
- Touch the Python worker's behavior or the embroidery algorithm.
- Introduce Stripe, transactions, or any psychable subsystem this app lacks.
- Switch any provider (Mongo, R2, OpenAI, Brevo all stay).

## Progress

> **Status: core migration complete + verified — 23 slices, 270 tests green, every
> external SDK behind a port** (audited 2026-05-31; the audit's one finding — the
> application layer's sole `@/lib` import — was closed in slice 23 by moving the
> `SUPPLY_*` tolerance constants into `domain/embroidery/supply-tolerance.ts`
> (re-exported from the old `lib/.../constants.ts` so flat callers are unchanged),
> so `application/` is now 100% `@/lib`-free). `openai` lives only in
> `OpenAiChatGateway`, `@aws-sdk` only in `R2ObjectStore`; `mongodb` is confined
> to `lib/mongodb.ts` (the singleton client) + the still-flat lib helpers it backs
> (`users`/`ai/conversations`/`indexnow-tracker`) + the chat routes' `ObjectId`
> id construction. The layer/dependency rules hold across `domain/` →
> `application/` → `infrastructure/` (inward) with `composition/` the only
> concrete-adapter wiring; no `app/` → `infrastructure/` shortcut and no use-case
> imports a concrete SDK. **Deferred tail (all intentional, documented below):**
> the Ink-Stitch trio (`apply-attrs`/`thread-palette`/`gpl-palette` — the bundled
> `.gpl` `import.meta.url`/Turbopack load needs a `next build` check, out of the
> `npm test`/`tsc` gate); the shared flat helpers kept under the "delete a shared
> lib only when its LAST consumer migrates" rule (`getCachedSession`, the *read*
> side of `lib/ai/conversations`, `lib/cache`, `lib/users`, the `lib/indexnow*` +
> `lib/r2` shims, the `jobs/sources/*-pull` parsers); and the flat SMS surface +
> the two standalone `WORKER_URL` tool routes (`image-to-svg`, embroidery
> `convert`) that were never in scope of a slice. The public "Anthropic API"
> wording is marketing copy in content JSON / README (out of code scope) — see
> [`external-services.md`](external-services.md).

Conventions locked in by the first slice (reuse these — don't reinvent):

- **`Result<T, E>`** lives at `src/domain/shared/result.ts` (`ok`/`err`/`isOk`/
  `isErr`); pure shared helpers (e.g. `escape-html.ts`) sit under
  `src/domain/shared/`.
- **Ports** live at `src/application/ports/<capability>.ts`, named for the
  capability and owning their DTOs.
- **Use-cases** at `src/application/use-cases/<feature>/<verb-phrase>.ts` as a
  `createX(deps)` factory returning an object with `.execute(input)`; co-located
  `*.test.ts` exercises them against in-memory fakes.
- **Adapters** at `src/infrastructure/<area>/<Tech><Port>.ts`.
- **Wiring** in `src/composition/container.ts` (`createContainer()`) — the only
  place that imports concrete adapters and reads env/config. Driving adapters
  call `createContainer()` and resolve a use-case.
- **Testing:** Vitest (`npm test`), config at `vitest.config.ts` (node env, `@`
  alias, `src/**/*.test.ts`).

Completed slices:

| Slice | Driving adapter | Use-case | New ports / adapters | Flat code retired |
| --- | --- | --- | --- | --- |
| **Contact form** | `POST /api/contact` | `SubmitContactInquiry` | `EmailSender` → `BrevoEmailSender` | `sendContactInquiryToOwner` + `sendContactAutoResponse` dropped from `src/lib/email.ts` |
| **Magic-link sign-in** | `POST /api/auth/magic-link` (mint) + `auth.ts` `authorize` (consume) | `RequestMagicLink`, `ConsumeMagicLink` | `MagicLinkTokens` → `InProcessMagicLinkTokens`; `UserRepository` → `MongoUserRepository` (minimal, wraps `lib/users`); reuses `EmailSender` | **`src/lib/magic-link.ts` deleted** (both consumers migrated); `sendMagicLinkEmail` dropped from `src/lib/email.ts` |
| **Embroidery-ready email** | `POST /api/embroidery/api/generate-from-url` (best-effort notify step) | `NotifyEmbroideryReady` | reuses `EmailSender` (3rd consumer) | **`src/lib/email.ts` deleted** — the entire email surface now goes through `EmailSender` |
| **Resume read** | `/resume` page + `get_resume` chat tool | `GetResume` | `ContentSource` → `FsJsonContentSource`; new **`composition/content.ts`** (`createContentContainer`) | **`src/lib/resume.ts` deleted** (both consumers migrated) |
| **Projects read** | `/` (home featured strip), `/projects`, `/projects/[slug]`, `/baton-rouge-software-developer`, `sitemap.ts`, the IndexNow worker job, `search_projects` chat tool + page-context | `GetAllProjects`, `GetFeaturedProjects`, `GetProjectBySlug` | widened `ContentSource` with `readJsonCollection`; same `FsJsonContentSource` (now memoizes per-dir too) | **`src/lib/projects.ts` deleted** (all seven consumers migrated); `ProjectCaseStudy` moved to `domain/content/project.ts` |
| **Blog read** | `/blog`, `/blog/[slug]`, the home latest-posts strip, `sitemap.ts`, the `rss.xml` route, the IndexNow worker job, `search_blog` chat tool | `GetAllPosts`, `GetPostBySlug`, `GetAllTags`, `GetPostsByKind` | widened `ContentSource` with `readJsonCollectionWithNames` + a `"repo-root"` base (blog lives at repo-root `blog/`, outside `src/content/`); same `FsJsonContentSource` | **`src/lib/blog.ts` deleted** (all seven consumers migrated); `BlogPost`/`PostKind` moved to `domain/content/blog-post.ts`, filename→date/slug rule in `parseBlogPost` |
| **Testimonials + marquee reads** | `/` (home) + `/baton-rouge-software-developer` | `GetTestimonials`, `GetMarqueeItems` | none — reused `readJson` (single-file array reads; no port surface added) | **`src/lib/testimonials.ts` + `src/lib/marquee.ts` deleted** (both consumers migrated); `Testimonial` moved to `domain/content/testimonial.ts` (marquee stays `string[]`, no named type) |
| **API-key auth / `requireAuth`** | the `requireAuth` shim (`src/lib/api-auth.ts`) + all 13 gated route handlers (3 direct: `/api/sms`, `/api/tools/embroidery-supplies/{refresh,download-links}`; 10 via the `src/app/embroidery/_lib/auth.ts` wrapper) | `AuthenticateRequest` (the three-path resolver, exact order) | `SessionGateway` → `NextAuthSessionGateway`; `ApiKeyVerifier` → `ApiKeyVerifierAdapter`; `ServiceKeyVerifier` → `ServiceKeyVerifierAdapter` | `api-auth.ts` shrunk to the shim + the shared `hashApiKey`/`evictCachedApiKey`/`apiKeyCacheKey` re-exports; `AuthPrincipal` moved to `domain/auth/principal.ts`; the in-file `resolveApiKey`/`safeEqual`/`CachedPrincipal` internals retired into the use-case + adapters |
| **AI content tools** | the tool dispatcher (`registry.ts`) + the `executeSearchProjects` / `executeSearchBlog` / `executeGetResume` thin delegates in `src/lib/ai/tools/*` | `SearchProjects`, `SearchBlog`, `GetResumeSection` (in `application/use-cases/ai/`, each composing the existing content read it needs — `GetAllProjects` / `GetAllPosts` / `GetResume` — via `composition/content.ts`) | none new — composes existing content reads through the DB-free `content.ts` container | the ranking/scoring/section logic + the result DTOs (`ProjectHit`/`BlogHit`/`GetResumeResult` + `*Args`) moved out of `src/lib/ai/tools/*` into the use-cases; the three tool files shrank to their OpenAI descriptor + a one-line delegate (re-exporting the `*Args`/result types so `registry.ts` is unchanged) |
| **Cache port** | none — driven-port inversion, no driving adapter / use-case | none — infra-only | `Cache` → `MemTtlCache` (a thin delegate over the existing `lib/cache` store) | none deleted — `src/lib/cache.ts` **stays** as the one shared `globalThis` store; it only loses its two infra-adapter importers (`ApiKeyVerifierAdapter`, `InProcessMagicLinkTokens`), which now take the injected `Cache` port |
| **API-key issuer** | the `issueApiKeyAction` server action (`embroidery/_lib/api-key-actions.ts`) | `IssueApiKey` | widened `ApiKeyVerifier` with `hash(plaintext)` + `evict(hash)` (same adapter, reusing its `hashApiKey`/`apiKeyCacheKey`, eviction through the injected `Cache`); widened `UserRepository` with `getApiKeyHash` + `setApiKeyHash` | the now-dead `hashApiKey`/`evictCachedApiKey`/`apiKeyCacheKey` **re-exports removed from `src/lib/api-auth.ts`** (the issuer was their last importer); the key generation, persist-hash, and rotate-evict logic left the action |
| **Google sign-in** | the NextAuth `signIn` callback's **Google branch** (`src/lib/auth.ts`) | `FindOrCreateGoogleUser` | widened `UserRepository` with `findOrCreateGoogleUser(input) → AuthUser` (same `MongoUserRepository`, delegating to `lib/users.findOrCreateGoogleUser` and mapping `User` → `AuthUser`) | **nothing deleted** — `lib/users.findOrCreateGoogleUser` *stays* as the Mongo impl the adapter wraps (its match-googleId / match-email / insert logic is unchanged); only `auth.ts`'s direct import of it was dropped. `getCachedSession` stays flat |
| **PingIndexNow worker job** (first worker-subsystem sub-slice) | the cron scheduler in `src/worker/index.ts` (drives it via the thin `runIndexNowPing` wrapper in `src/worker/jobs/indexnow-ping.ts`) | `PingIndexNow` | `IndexNowLog` → `MongoIndexNowLog` (wraps `lib/indexnow-tracker`); `IndexNowSubmitter` → `HttpIndexNowSubmitter` (wraps `lib/indexnow`) | **nothing deleted** — `lib/indexnow-tracker` + `lib/indexnow` *stay* (wrapped, not modified — the due-logic `$or` query and the batched submission are unchanged); the (a)–(f) orchestration + the injected config (`staticRoutes` / `projectBaselineDate` / `baseUrl`) left the job file, which shrank to a one-line `createContainer().pingIndexNow.execute()` |
| **ObjectStore (R2) port** (driven-port inversion, no user action) | none — infra-only; the five still-flat R2 consumers reach it through the unchanged `lib/r2` shim | none — infra-only | `ObjectStore` → `R2ObjectStore` (now the **sole `@aws-sdk` importer**) | **nothing deleted** — `src/lib/r2.ts` *stays* as a thin shim (four exported functions delegating to `getObjectStore()`); it only loses its `@aws-sdk` imports. The S3 client construction, `applyEnvPrefix`, `getBucket`, and all four operations moved verbatim into the adapter |
| **SupplyFeedSource (vendor pulls)** (driven-port layer of the supply-feed worker; orchestrator stays flat) | none — driven-port layer only; the still-flat `runRefreshEmbroiderySupplies` orchestrator now builds its `VENDORS` from the composition | none — the orchestrator use-case is the **next** slice | `SupplyFeedSource` → 7 vendor adapters in `infrastructure/supply-feed/` (`Gunnold`/`Sulky`/`Allstitch`/`Habanddash`/`Coldesi`/`Threadart`/`Ohmycrafty` `FeedSource`), each **wrapping the unchanged `jobs/sources/<vendor>-pull` parser**; wired DB-free in **`composition/supply-feed.ts`** (`getSupplyFeedSources()`) | **nothing deleted** — the `*-pull.ts` parsers *stay* in `jobs/sources/` (wrapped, not moved — relocation deferred); the orchestrator only swapped its 7 inline `{ name, pull }` literals + 8 pull imports for `const VENDORS = getSupplyFeedSources()`. madeirausa stays excluded (stub); Hab+Dash anonymous-without-creds preserved |
| **RefreshSupplyFeeds orchestrator** (the last big piece of the supply-feed worker) | cron scheduler (`src/worker/index.ts`) + manual-refresh route (`POST /api/tools/embroidery-supplies/refresh`) — **both unchanged**, still importing the thin `runRefreshEmbroiderySupplies` wrapper (route still imports `VENDOR_NAMES` from `compile-feeds`) | `RefreshSupplyFeeds` (`application/use-cases/supply-feed/refresh-supply-feeds.ts`, DB-free) — the ~260-LOC orchestration lifted verbatim, with the module-level `isRunning` flag now a closure-captured flag on a composition **singleton** (so it's still process-wide) | reuses `SupplyFeedSource` + `ObjectStore`; adds `LocalSnapshotSink` → `DiskLocalSnapshotSink` (dev-gating lives in the adapter) + `FeedCacheInvalidator` → `FeedReaderCacheInvalidator` (wraps `invalidateFeedCache`); `compileFeeds` kept as an **injected** pure-ish function dep, `VENDOR_NAMES` injected too. Wired DB-free in `composition/supply-feed.ts` (`getRefreshSupplyFeeds()`) | **nothing deleted** — `compile-feeds.ts` (incl. `compileFeeds` + `VENDOR_NAMES` + the `*PullResult`/`CompileInput` types) and the `*-pull.ts` parsers all *stay* unchanged (parser relocation still deferred). `refresh-embroidery-supplies.ts` shrank from ~260 LOC to a 3-line thin wrapper (`getRefreshSupplyFeeds().execute(options)`) + a `RefreshResult` re-export |
| **EmbroideryComputeGateway** (first embroidery-pipeline sub-slice — driven-port inversion of the Python-service HTTP client; no user action, no use-case; DB-free wiring) | none — driven-port only; `pipeline.ts`, both generate routes, and `ai/select-palette.ts` reach it through the unchanged `_lib/worker.ts` shim | none — infra-only | `EmbroideryComputeGateway` → `HttpEmbroideryWorker` (`infrastructure/embroidery/http-embroidery-worker.ts`), now the **sole knower of `WORKER_URL` / speaker of `node:http` to the Python service**; wired DB-free in **`composition/embroidery-compute.ts`** (`getEmbroideryComputeGateway()` singleton) | **nothing deleted** — `src/app/embroidery/_lib/worker.ts` *stays* as a thin shim (the 3 fns one-line-delegate to `getEmbroideryComputeGateway()`; it re-exports `WorkerError` + `ClusterRouting`/`SampledColor`/`SampledColors` from the port). It only loses its `node:http`/`node:https`/`node:url` imports |
| **Embroidery quota rule** (pure-domain extraction — no port, no use-case) | none — the four importers (`/api/embroidery/generate`, `/embroidery/api/generate-from-url`, `/embroidery` page, `ImageUploader.tsx`) repoint their import directly; no DI | none — pure rule | none — `computeQuota` + `Quota` + `MONTHLY_LIMIT`/`WINDOW_DAYS`/`WINDOW_MS` moved **verbatim** into `domain/embroidery/quota.ts` and unit-tested | **`src/app/embroidery/_lib/quota.ts` deleted** (all four importers repointed to `@/domain/embroidery/quota`) |
| **Embroidery geometry libs → domain** (pure-domain relocation — no port, no use-case; same shape as the quota slice) | none — the geometry barrel's two importers (`_lib/inkstitch/apply-attrs.ts` internal + `_lib/ai/tag-svg.ts`) repoint their import directly; no DI | none — pure SVG path math | none — the **8 pure geometry files** (`path-parser`, `enclosure`, `prefilter`, `metrics`, `analyze-svg`, the `index.ts` barrel, `types`, `strip-paths`) moved **verbatim** into `domain/embroidery/geometry/` (subfolder kept; intra-lib relative imports unchanged) and the highest-value ones unit-tested | **`src/app/embroidery/_lib/geometry/*` deleted** (both barrel importers repointed to `@/domain/embroidery/geometry`). The `inkstitch/` trio (`apply-attrs` + `thread-palette` + `gpl-palette`) is **deferred** — see note below |
| **LlmGateway + embroidery AI** (the long-deferred keystone — the OpenAI client behind a port; DB-free wiring) | none — driven-port repoint; both embroidery AI consumers (`_lib/ai/select-palette.ts` `selectPalette` + `_lib/ai/tag-svg.ts` `askOpenAI`) stay flat functions, just sourcing the LLM through the port | none — the AI calls stay in the flat consumers; the `RunEmbroideryPipeline` use-case is later | `LlmGateway` → `OpenAiChatGateway` (`infrastructure/llm/openai-chat-gateway.ts`, the sole `openai`-SDK touch on the embroidery-AI path); wired DB-free in **`composition/llm.ts`** (`getLlmGateway()` singleton). One domain-shaped method, `generateJsonFromImage({ model, temperature, systemPrompt, userText, imageUrl }) → Promise<string>` — no OpenAI types leak | **nothing deleted** — `src/lib/ai/client.ts` (`getOpenAI`) **stays**: `chat.ts`'s tool-loop call still imports it, and the adapter imports it too (full SDK isolation lands when chat migrates). `chat.ts`/`conversations.ts`/`pipeline.ts` are **byte-for-byte unchanged** |
| **RunEmbroideryPipeline** (the embroidery-pipeline keystone — the generate orchestrator lifted into a use-case; DB-free wiring) | none directly — all three generate routes (`/embroidery/api/generate`, `/embroidery/api/generate-from-url`, `/api/embroidery/generate`) reach it through the **unchanged** thin `runPipeline` wrapper in `_lib/pipeline.ts` (they keep importing `runPipeline` + the validators/constants) | `RunEmbroideryPipeline` (`application/use-cases/embroidery/run-embroidery-pipeline.ts`, DB-free) — the ~389-LOC orchestration lifted **verbatim**, with `SKIP_AI_PALETTE = true` preserved exactly (the AI palette stays skipped) | reuses `EmbroideryComputeGateway` (compute) + `ObjectStore` (R2) + the `LlmGateway`-backed AI (`selectPalette`/`tagSvg` injected as functions); adds **`LocalArtifactSink`** → `DiskLocalArtifactSink` (fs + the `process.cwd()/tmp/embroidery` path verbatim in the adapter, mirroring `DiskLocalSnapshotSink`). The pure validators/constants/errors + `extractZip` + `hashPng` moved to **`domain/embroidery/pipeline-validation.ts`**. Wired DB-free in **`composition/embroidery-pipeline.ts`** (`getRunEmbroideryPipeline()` singleton) | **nothing deleted** — `_lib/pipeline.ts` shrank from ~389 LOC to a thin wrapper that one-lines `getRunEmbroideryPipeline().execute(...)` and **re-exports** the validators/constants/errors/types (`validateSize`/`validateCustomerId`/`ALLOWED_SIZES`/`TEST_CUSTOMER_ID`/`DEFAULT_COLORS`/`MIN_COLORS`/`MAX_COLORS`/`InvalidSizeError`/`InvalidCustomerIdError`/`AllowedSize` + `PipelineResult`/`PipelineOptions`) so the 3 generate routes (+ the `convert`/`sizes` routes that import `ALLOWED_SIZES`/`validateSize`) are byte-for-byte unchanged. `gpl-palette` (`loadPalette`/`filterAvailable`) stays flat (the deferred build-fragile piece) — **injected** into the use-case and called transitionally |
| **Chat loop + conversations** (the FINAL subsystem — the portfolio-assistant tool loop behind `LlmGateway`; full SDK isolation) | `POST /api/chat` (via the **unchanged** thin `runAssistantTurn` / `summarizeAndSetTitle` wrappers in `src/lib/ai/chat.ts`, which resolve the use-cases from `container.ts` and adapt the `ObjectId` id → string); the other three chat routes (`/api/chat/conversations`, `/api/chat/conversations/[id]`, `/api/chat/claim`) keep calling `lib/ai/conversations` directly — read side untouched | `RunAssistantTurn` + `SummarizeConversationTitle` (`application/use-cases/chat/`) — the tool loop + the titler lifted **verbatim** (model `gpt-5.4-mini`, temps 0.7 / 0.3, `max_completion_tokens` 1500 / 60, the 50-msg window, BASE_SYSTEM_PROMPT incl. the tolerance interpolation, the ≤4-iteration cap + fallback, the `finish_reason === "tool_calls"` round-trip, the title parse + clamp(60)) | `LlmGateway` gained a second, tool-loop method — `createChatCompletion({ model, temperature, maxCompletionTokens, messages, tools?, responseFormatJson? }) → { hasChoice, content, toolCalls, finishReason }` — with domain-shaped DTOs (`ChatMessage` union, `ToolCall`, `ToolSchema`) so **no OpenAI types cross the boundary**; the adapter does the bidirectional message ↔ tool_call mapping. New **`ConversationStore`** port → `MongoConversationStore` (wraps `lib/ai/conversations` `appendMessage`/`setTitle`); `resolvePageContext` lifted to `composition/chat-page-context.ts` and injected; `dispatchTool`/`toolSchemas` injected from the **unchanged** `registry.ts`. Wired in the DB-backed `container.ts` (reuses `getLlmGateway()`) | **`src/lib/ai/client.ts` deleted** — `chat.ts` was its last `getOpenAI` consumer; `getClient()` moved into `OpenAiChatGateway`, which is now the **sole `import OpenAI from "openai"` in the app** (full SDK isolation). `ConversationMessage`/`ToolResultPayload` moved to `domain/chat/conversation-message.ts` (re-exported from `conversations.ts` so the routes are unchanged); `chat.ts` shrank to a 2-function wrapper that no longer imports `openai` |

Notes from the magic-link slice:

- **Reused a port across slices** — `EmailSender` now has two consumers; the
  abstraction paid off exactly as intended (zero adapter changes).
- **Whole-lifecycle migration to enable a deletion.** Mint and consume share the
  token store, so migrating only one half would have duplicated the store
  contract across two files. Doing both let `lib/magic-link.ts` be deleted
  outright. `auth.ts` stays flat but its `authorize` now calls
  `ConsumeMagicLink` via the container (one surgical swap).
- **Consumer-defined `UserRepository` is intentionally tiny** — just
  `findOrCreateByEmail`, the only method `ConsumeMagicLink` needs. It widens as
  later user use-cases migrate, never speculatively.
- `lib/cache.ts` is still imported directly by the token adapter (infra→infra);
  it gets its own `Cache` port when its many consumers (sessions, API keys,
  supply feed) migrate.

**Email surface fully migrated.** Three slices (contact, magic-link, embroidery)
each migrated their own user-action's email, and together they retired the flat
email layer: `EmailSender` now has three consumers and one adapter
(`BrevoEmailSender`); `src/lib/email.ts` and `src/lib/magic-link.ts` are both
gone. A provider swap is now a single new adapter + one composition edit.

> Note: the embroidery-ready email migrated as a **driven-adapter consolidation**
> — only the notify step of the (still-flat) generation route moved, swapping a
> direct `lib/email` call for `createContainer().notifyEmbroideryReady`. The rest
> of that route stays flat until the full embroidery pipeline slice. Touching one
> line of an un-migrated route to finish a port (cf. the `auth.ts` swap) is a
> legitimate step, not a half-measure.

Notes from the resume slice (read-side pattern established):

- **Composition can be more than one module.** `src/lib/mongodb.ts` *connects
  and throws on a missing `DATABASE_URL` at import time*, so resolving a static
  page's content from the full `container.ts` (which imports
  `MongoUserRepository`) would drag the database into the build. Content reads
  therefore get their own **`composition/content.ts`** (`createContentContainer`)
  that imports only `FsJsonContentSource`. The "adapters imported only in
  composition" rule is per-adapter, not "one function." A future improvement —
  make `mongodb.ts` lazy — would let the two merge.
- **`ContentSource` is async** even though the FS read is sync, because the port
  models the *capability*; a CMS/DB/R2-backed source is inherently async. The
  `/resume` page became an `async` Server Component; the adapter memoizes per
  path to preserve the old getter's read-once behavior.
- The `get_resume` **chat tool** now calls the `GetResume` use-case instead of
  reading the file inline — the start of "AI tools invoke use-cases through
  ports," with the rest of the tool registry still flat.

Notes from the projects slice (the cap-of-4 became code):

- **First collection read.** `ContentSource` widened by exactly one method —
  `readJsonCollection<T>(relativeDir)`, the consumer-defined shape the projects
  use-cases need — and `readJson` was left untouched (its existing consumer and
  fake didn't move). The adapter readdirs, filters `.endsWith(".json")` (the old
  getter's exact filter), parses each, and memoizes per directory under a
  `dir:` cache key; a missing directory yields `[]`, matching the old
  `fs.existsSync` guard.
- **Shaping rules moved into use-cases and got tested.** Ordering by
  `order ?? 99` lives in a shared `sortProjects` that all three use-cases build
  on. The **cap-of-4** — documented in `CLAUDE.md` but only ever implicit in the
  content data (today there are three featured) — is now an explicit application
  rule in `GetFeaturedProjects` (`FEATURED_CAP`), unit-tested by seeding six
  featured projects and asserting exactly four come back in `order`. Behavior is
  preserved: with ≤4 featured the slice and cap are identity.
- **Seven consumers, one of them not a page.** Beyond the obvious pages and the
  `search_projects` tool, the grep surfaced `sitemap.ts`, the
  `indexnow-ping` worker job, the `/baton-rouge-software-developer` landing
  page, and `chat.ts`'s page-context builder (a dynamic `import("@/lib/projects")`).
  `sitemap()` and the worker's `buildContentList()` became `async` to await the
  use-case — the sync→async ripple the resume note predicted, now realized
  across a driving adapter (Next sitemap) and a scheduler adapter.
- **Type-only consumers repoint, not rewire.** `ProjectCard.tsx` and
  `jsonld.tsx` imported only the `ProjectCaseStudy` *type*; they now import it
  from `@/domain/content/project`; with the blog slice it now imports `BlogPost`
  from `@/domain/content/blog-post` too — `lib/blog` is gone.

Notes from the blog slice (a second base dir; a richer collection read):

- **Named collection read, repo-root base.** Blog posts derive their `slug` and
  `date` *from the filename* (`YYYY-MM-DD-slug.json`), so the name-discarding
  `readJsonCollection` couldn't carry them. `ContentSource` grew exactly one
  consumer-defined method — `readJsonCollectionWithNames<T>(dir, base?)` →
  `{ name, data }[]` — plus a `ContentBase = "content" | "repo-root"` argument so
  the same `FsJsonContentSource` serves both `src/content/` and the repo-root
  `blog/` without the projects/resume reads changing. A new cache-key prefix
  (`named:<base>:<dir>`) preserves the read-once memoization; `readJson` and
  `readJsonCollection` were left untouched.
- **The filename convention is a pure domain rule.** The old `parseFile` —
  `.json`-only, date-prefixed-name regex, `slug`/`date` defaulted from the
  filename, the rest field-defaulted — moved verbatim into the domain's
  `parseBlogPost(name, data)`, returning `null` for non-posts. The `_`/`.` skip
  and the newest-first `date`-descending sort live in `GetAllPosts`; the adapter
  just hands over `{ name, data }`. All four shaping reads are unit-tested off an
  in-memory fake.
- **Four use-cases, one per old getter.** `GetAllPosts`, `GetPostBySlug`,
  `GetAllTags` (counts, descending), and `GetPostsByKind` (`"both"` matches both
  `article` and `video`; `"all"` returns everything) mirror `lib/blog.ts`'s
  surface — consumer-defined, no speculative methods. `jsonld.tsx` repointed its
  `BlogPost` *type* to the domain; `src/lib/blog.ts` was deleted once its last
  consumer left.

Notes from the testimonials + marquee slice (the no-new-port mop-up):

- **Zero port surface added.** Both reads are single files that *contain* arrays
  (`testimonials.json` is an array of objects; `marquee.json` an array of
  strings), so the existing `readJson<T>` is exactly right — `readJson<Testimonial[]>`
  and `readJson<string[]>`. No new method, no adapter change, no fake change. This
  is the payoff the projects/blog slices set up: a single-file array read needed
  nothing new.
- **The missing-file → [] guard moved into the use-cases.** The old getters
  returned `[]` when the file was *missing* (an `fs.existsSync` guard), but
  `readJson` *throws* on ENOENT. Each use-case therefore catches an ENOENT-coded
  error and yields `[]`, preserving the old behavior exactly (the files exist
  today, so this is defensive parity). The fakes throw an ENOENT-coded error for
  unknown files so that guard is unit-tested.
- **No named type for the marquee.** `getMarqueeItems()` was always `string[]`
  with no interface, so none was invented — only `Testimonial` moved to the
  domain. Both pages were already `async` Server Components resolving
  projects/blog from `createContentContainer()`, so the rewire just added two
  awaited use-case calls; no page restructuring. `src/lib/testimonials.ts` and
  `src/lib/marquee.ts` are both gone.

Notes from the API-key auth slice (first non-content, security-sensitive slice; NextAuth behind a port):

- **The validator migrated as one coherent vertical; the issuer did not.**
  `requireAuth` stays in `src/lib/api-auth.ts` as a thin driving-edge shim — it
  does the *structural* parse (pull `x-api-key` / `Authorization: Bearer` off
  the headers) and maps the use-case's `Result` back to the historical
  `Response | AuthPrincipal` contract, so all 13 gated route handlers and the
  embroidery `_lib/auth.ts` wrapper stay byte-for-byte unchanged. The auth
  *decision* — the three-path order, the `pwsk_` discriminator, the crypto, the
  caches — moved into `AuthenticateRequest` + its three adapters. This mirrors
  `auth.ts`'s `authorize` delegating to `ConsumeMagicLink` (a blessed pattern).
  The issuer (`embroidery/_lib/api-key-actions.ts`) and the NextAuth
  `authOptions` config are explicitly **later** slices and were left flat.
- **Issuer/verifier parity is structural, not by convention.** `hashApiKey`
  (HMAC-SHA256 keyed by `NEXTAUTH_SECRET`), `apiKeyCacheKey` (`apikey:<hash>`),
  and `evictCachedApiKey` are the single source of truth and now *live in*
  `ApiKeyVerifierAdapter`; `api-auth.ts` re-exports them so the issuer keeps
  importing them from `@/lib/api-auth` unchanged. Issuer and verifier resolve to
  the *same* functions, so a rotate's `evictCachedApiKey` targets the exact
  cache entry the verifier writes — they can't drift.
- **Three consumer-defined ports, behavior preserved exactly.**
  `SessionGateway.getCurrentPrincipal()` wraps `getCachedSession()` (NextAuth now
  fully behind a port — a first); `ApiKeyVerifier.verify()` owns the 20-min
  read-through cache + `findUserByApiKeyHash`; `ServiceKeyVerifier.matches()`
  owns env access + the `timingSafeEqual`/SHA-256 comparison, true only when both
  expected and provided are non-empty. The use-case checks the `pwsk_` prefix
  **before** calling `verify` (preserving the DB-avoidance discriminator), and a
  `pwsk_` key that resolves to no user returns `UNAUTHORIZED` **without** falling
  through to the service path — both invariants are unit-tested with fakes (no
  cookies, no DB, no env), the payoff this slice was set up to deliver.
- **`AuthPrincipal` moved to `domain/auth/principal.ts`** and is re-exported from
  `api-auth.ts` (and through the embroidery wrapper) so no consumer's import
  broke. The 401 body/status, the resolution order, and every TTL/cache key are
  identical to the pre-migration `requireAuth`.

Notes from the AI content-tools slice (use-case composing use-case; the LLM client stays flat):

- **The tool *logic* moved; the tool *descriptor* did not.** Each of the three
  content tools (`search_projects`, `search_blog`, `get_resume`) was two things
  fused in one file — an OpenAI-coupled descriptor object and a substantial
  inline ranking/scoring/shaping function. This slice split them: the ranking,
  the tie-breaks, the limit clamp, the truncation, and the result DTOs lifted
  into `SearchProjects` / `SearchBlog` / `GetResumeSection` under
  `application/use-cases/ai/`, while the descriptor (`searchProjectsTool` et al.)
  and the `registry.ts` dispatcher stayed flat — they're LLM-coupled config that
  migrates with the **later chat + `LlmGateway` slice**. `executeSearchProjects`/
  `executeSearchBlog`/`executeGetResume` keep their exact signatures and shrank
  to a one-line `createContentContainer().<x>.execute(args)`, so `registry.ts`
  did not change.
- **Use-case composing use-case — deliberately.** These three need *only*
  content the rest of the app already reads, so rather than re-read the
  filesystem they take the existing content use-case as a dep
  (`createSearchProjects({ getAllProjects })`, etc.). That keeps the project
  sort/cap and the blog newest-first/parse rules in **one** place — the AI
  surface ranks the *same* ordered list the `/projects` and `/blog` pages render,
  which is exactly the "tools can't reach data the rest of the app can't" honesty
  rule from [`external-services.md`](external-services.md). They wire through the
  DB-free `composition/content.ts`, not the Mongo-backed `container.ts`, so the
  no-DB-in-content-container rule holds even though the chat route is dynamic.
- **The ranking is a pure, exported function — that's the testability payoff.**
  `rankProjects(projects, args)`, `rankPosts(posts, args)`, and
  `selectResumeSection(resume, args)` take already-read data and do no I/O, so
  the scoring weights (name×4 / tagline×3 / stack±3 / problem·outcome·highlight×1;
  title×3 / description×2 / tag±2 / body×1), the tie-breaks (projects: score →
  featured → `order ?? 99`; posts: score → `date` descending), the
  `min(10, max(1, limit ?? 5))` clamp, the word-boundary-vs-hard-cut `truncate`,
  the exact-tag filter, and the `contact`-with/without-`phone` assembly are all
  unit-tested directly against fakes — 37 new tests, no disk, no OpenAI. Byte-for-
  byte parity with the flat tools was the gate.

Notes from the Cache port slice (a driven-port inversion — no user action, no use-case):

- **Pure dependency inversion, zero behavior change.** This slice has no driving
  adapter and no use-case — it puts a `Cache` port
  (`application/ports/cache.ts`) in front of the in-process TTL store and rewires
  the two **already-migrated** infra adapters that were still reaching into
  `@/lib/cache` directly (`ApiKeyVerifierAdapter`, `InProcessMagicLinkTokens`).
  They now take `{ cache: Cache }` as a constructor dep and call
  `this.cache.get/set/delete`; `container.ts` constructs one `MemTtlCache`
  singleton and injects it into both. It closes the infra→infra import the
  magic-link slice flagged.
- **Synchronous by contract — the magic-link single-use rests on it.** The port
  is deliberately sync (`get`/`set`/`delete` return values, not Promises), not
  for convenience but because `InProcessMagicLinkTokens.consume` does a
  read-then-delete that must run atomically w.r.t. the event loop — two
  concurrent consumes can't both see the entry. An async port would insert an
  `await` between the read and the delete and break that guarantee. The injected
  fake is sync too, so the unit test exercises the exact contract.
- **One shared store, never a second one.** `MemTtlCache` is a *thin delegate*
  over the existing `lib/cache` functions (`get → getCached`,
  `set → setCached`, `delete → deleteCached`); it does **not** allocate its own
  `Map`. That is load-bearing: the still-flat consumers stay on `lib/cache`
  untouched — `getCachedSession` (via `getCachedOrFetch`, 10-min session TTL) and
  the two embroidery in-flight locks (`generate-from-url`, `generate`) — and they
  must see the *same* entries the port-based adapters write. `lib/cache.ts`
  therefore **stays** as the single `globalThis.__memCache` store; it only loses
  its two infra-adapter importers and keeps its other three consumers. (The port
  intentionally omits `getOrFetch` — only the still-flat `getCachedSession` uses
  `getCachedOrFetch`, and it stays flat; `ttlMs` is required on `set` because
  both migrated callers always pass an explicit TTL, so no use-case leans on the
  1 h default.)
- **Issuer-eviction parity is preserved structurally.** The module-level
  `evictCachedApiKey`/`apiKeyCacheKey`/`hashApiKey` in `ApiKeyVerifierAdapter`
  stay module-level (the still-flat issuer `embroidery/_lib/api-key-actions.ts`
  imports them via the `api-auth` re-export, not through the container).
  `evictCachedApiKey` keeps calling `lib/cache.deleteCached` directly — and
  because `MemTtlCache` delegates to that same singleton, the class's
  `cache.delete` and the module-level `evictCachedApiKey` hit the **one** store,
  so a rotated key is still evicted from the exact entry the verifier wrote. The
  `api-auth.ts` re-exports and the issuer file are unchanged.
- **Tests inject a fake; the adapter test exercises the real store.** The
  adapter tests use a small sync Map-based `FakeCache`
  (`application/ports/cache.fake.ts`) so they can't bleed through the shared
  `globalThis` store — the magic-link single-use (consume twice → second
  `null`) is asserted against the injected port, and the new
  `ApiKeyVerifierAdapter` test asserts read-through + cache-hit-skips-lookup +
  no-user-caches-nothing with `@/lib/users` mocked (no DB). `MemTtlCache`'s own
  test runs against the **real** `lib/cache` store (unique keys per test) to
  prove the delegation and that `ttlMs` actually bounds the entry (fake timers →
  expiry reads back `null`).

Notes from the API-key issuer slice (auth-closeout part 1 — the validator was slice 8):

- **The issuer rejoined the validator behind one port.** The `requireAuth`
  slice migrated only the *validator* and left the issuer flat, importing
  `hashApiKey`/`evictCachedApiKey` from the `api-auth` re-export so the two
  couldn't drift. This slice finishes the pair: `IssueApiKey`
  (`application/use-cases/auth/issue-api-key.ts`) takes an already-authenticated
  `userId`, generates the `pwsk_<uuid>` plaintext, persists *only* its HMAC, and
  evicts any previous hash on rotate — all through the **same**
  `ApiKeyVerifier` adapter the validator uses. Rather than a second small port,
  `ApiKeyVerifier` widened by exactly two consumer-defined methods — `hash(plaintext)`
  and `evict(hash)` — so there is still **one** `hashApiKey`, **one**
  `apikey:<hash>` scheme, and **one** cache store; a rotate's `evict` can only
  ever target the entry `verify` wrote. Eviction now runs through the injected
  `Cache` port (`this.deps.cache.delete(apiKeyCacheKey(hash))`) instead of the
  module-level `deleteCached`, which is the same singleton anyway.
- **Edge session auth stayed at the edge, verbatim.** Session auth is *not* this
  slice — the action still does `getCachedSession()` and `throw new Error("Unauthorized")`
  on no `session.user.id` (a thrown error, not a `Response`, so `ApiKeyPanel`'s
  try/catch surfaces the message unchanged), then delegates to
  `createContainer().issueApiKey.execute({ userId })`. Same `{ apiKey }` return
  shape, so `ApiKeyPanel.tsx` is untouched; `page.tsx`'s `hasApiKey` read (a
  direct `getUserById`) is a different code path and was left alone.
- **`UserRepository` widened, not duplicated.** It grew `getApiKeyHash` (→
  `getUserById(userId).apiKeyHash ?? null`) and `setApiKeyHash` (→
  `lib/users.setApiKeyHash`) in `MongoUserRepository`, both still delegating to
  `lib/users` — `findOrCreateByEmail` is intact. The previous-hash read is what
  lets the use-case evict the *old* key on rotate.
- **A re-export went away once its last importer left.** With the issuer no
  longer importing `hashApiKey`/`evictCachedApiKey`/`apiKeyCacheKey` from
  `@/lib/api-auth` (grep-confirmed: every remaining `@/lib/api-auth` importer
  uses only `requireAuth`/`AuthPrincipal`), those three re-exports were removed
  from `api-auth.ts`. The functions themselves stay the source of truth inside
  `ApiKeyVerifierAdapter` (reached through the port's `hash`/`evict` and still
  imported directly by the adapter's own test) — only the dead pass-through
  shrank. `IssueApiKey` is unit-tested against fakes: `pwsk_` prefix, the HMAC
  (not the plaintext) is persisted, rotate evicts the *previous* hash, no
  eviction without a previous hash, and the returned plaintext is the one
  hashed. The edge unauthorized-throw stays in the action (covered at the edge,
  same as the validator shim).

Notes from the Google sign-in slice (auth-closeout part 3 — the `signIn` decision behind a use-case):

- **The two `signIn` branches now share one shape.** The magic-link branch
  already delegated to `ConsumeMagicLink` (via `authorize`); this slice gives the
  Google branch its symmetric counterpart — `FindOrCreateGoogleUser`
  (`application/use-cases/auth/find-or-create-google-user.ts`), resolved from the
  container. The driving adapter (the `signIn` callback) stays the *gate*: it
  still rejects a non-`google`/non-`magic-link` provider, a missing
  `providerAccountId`, and a missing `user.email`; still wraps the provisioning
  call in `try/catch` returning `false`; still `return true` on success. Only the
  provisioning *call* moved — `findOrCreateGoogleUser({...})` from `./users`
  became `createContainer().findOrCreateGoogleUser.execute({...})`, and the id/role
  stash changed from `dbUser._id!.toString()` to the use-case's already-mapped
  `dbUser.id`. The `jwt` and `session` callbacks are untouched.
- **A pass-through use-case, kept on purpose.** `FindOrCreateGoogleUser` is a
  one-line delegate to the port today, but it earns its place: the container keeps
  exposing **use-cases, not raw repositories** (symmetric with `ConsumeMagicLink`),
  and Google-specific provisioning policy — allow-lists, role assignment,
  first-user-is-admin — has a natural home if it ever grows. The
  match-googleId / match-email / insert *rules* stay in the adapter.
- **`UserRepository` widened, nothing deleted.** It grew
  `findOrCreateGoogleUser(input: GoogleUserInput) → AuthUser`;
  `MongoUserRepository` implements it by delegating to the **unchanged**
  `lib/users.findOrCreateGoogleUser` and mapping the Mongo `User` down to the slim
  `AuthUser` (`id` from `_id.toString()`, plus `email` + `role`) — the same wrap
  the rest of the repo uses. `lib/users.findOrCreateGoogleUser` was that function's
  only consumer (grep-confirmed) and *stays* as the Mongo implementation the
  adapter wraps. Unit-tested against a fake repo (returns the `AuthUser` the repo
  yields; passes the Google identity through verbatim); the two existing
  `FakeUserRepository` fakes (consume-magic-link, issue-api-key) gained the new
  method so `tsc` stays green.

Notes from the PingIndexNow slice (the first worker-subsystem sub-slice — the cron scheduler is now a thin driving adapter):

- **Cron is just another driver.** The weekly IndexNow sweep was the cleanest
  worker job to move first — self-contained, two driven actors, no shared
  mutual-exclusion flag (unlike the supply refresh). `PingIndexNow`
  (`application/use-cases/indexnow/ping-indexnow.ts`) holds the exact (a)–(f)
  orchestration the flat `runIndexNowPing` did — the static-route + projects +
  posts content list, the `Promise.all` upsert, the nothing-due early return, the
  base-url mapping, and the **stamp-only-on-success** rule (a failed submission
  returns `{ due: n, pinged: 0 }` and leaves `lastPingedAt` untouched so the next
  run retries). Every `console.log`/`console.error` line and elapsed-time timing
  moved verbatim — they're part of the behavior. This is the model for the later
  `RefreshSupplyFeeds` job.
- **Two consumer-defined driven ports, both wrapping unchanged lib.**
  `IndexNowLog` (`upsert` / `findDue` / `stampPinged`) sits in front of the Mongo
  `indexnow_log` ledger; `MongoIndexNowLog` delegates to the **unchanged**
  `lib/indexnow-tracker` (the due-logic `$or` query — never pinged / content
  changed / stale > 7 days — *stays in lib for now*, the adapter only narrows the
  rows to `pagePath`). `IndexNowSubmitter.submit` sits in front of the HTTP ping;
  `HttpIndexNowSubmitter` delegates to the **unchanged**
  `lib/indexnow.submitToIndexNow` (batching, key/host, best-effort error
  swallowing). The submitter's result shape (`ok` + batch counts) is preserved on
  the port so the use-case keeps its failure log and its `ok`-gated stamp.
  **`lib/indexnow-tracker` and `lib/indexnow` stay — wrapped, not deleted.**
- **Config is injected, not imported — for testability.** The use-case takes
  `{ staticRoutes, projectBaselineDate, baseUrl }` as plain data deps rather than
  importing `STATIC_ROUTE_DATES` / the `PROJECT_BASELINE_DATE` constant /
  `SITE.url` directly, so the (a)–(f) orchestration is unit-testable against
  fakes with no real constants. The composition supplies them (the empty-string
  static route → `"/"` and the trailing-slash strip on `baseUrl` are preserved in
  the wiring). The content reads are the already-migrated `GetAllProjects` /
  `GetAllPosts` use-cases, injected the same way.
- **Wired into the DB-backed `container.ts`, not `content.ts`.** The job needs
  Mongo for the ledger and every caller is the cron scheduler (never a static
  page), so `PingIndexNow` lives in the full `createContainer()`; its content
  reads are constructed there off a `FsJsonContentSource`. `src/worker/index.ts`
  keeps its schedule (`30 4 * * 3`), `America/New_York` timezone, `try/catch`, and
  `shuttingDown` guard **verbatim** — it still imports the thin `runIndexNowPing`,
  which shrank to `createContainer().pingIndexNow.execute()`. The four unit tests
  assert the content-list build, the nothing-due short-circuit (submitter never
  called), the success path (urls = base + pagePath, stamp the due paths,
  `{ due: n, pinged: n }`), and — the riskiest rule — that a failed submission
  does **not** stamp and returns `{ due: n, pinged: 0 }`.

**Auth surface essentially closed.** Four slices took the auth machinery onto the
hexagon: the **validator** (`AuthenticateRequest`, slice 8), the **API-key issuer**
(`IssueApiKey`, slice 11), **magic-link sign-in** (`RequestMagicLink` /
`ConsumeMagicLink`, earlier), and **Google sign-in** (`FindOrCreateGoogleUser`,
here). What's left flat in `src/lib/auth.ts` is the `authOptions` config wiring and
**`getCachedSession`** — a hot-path session helper imported directly by many
still-flat route handlers (the chat routes, etc.), so it migrates with those
consumers, not before. Beyond it, only the big subsystems (the chat loop +
`LlmGateway`, the embroidery pipeline, the worker/supply feeds) remain.

Notes from the ObjectStore (R2) slice (a driven-port inversion — no user action, no use-case; DB-free wiring):

- **Pure dependency inversion, byte-for-byte behavior.** Like the Cache slice,
  this has no driving adapter and no use-case — it puts an `ObjectStore` port
  (`application/ports/object-store.ts`) in front of Cloudflare R2 and moves the
  S3 implementation out of `src/lib/r2.ts` into `R2ObjectStore`
  (`infrastructure/object-store/r2-object-store.ts`). The S3 client construction
  (region/endpoint/credentials + the exact missing-creds error message), the
  `dev_` `applyEnvPrefix` choke point, `getBucket`, the public-URL slash
  handling, the presigned-URL TTL default (15 min) + filename
  `Content-Disposition` (double-quote-stripped, never env-prefixed) +
  `expiresAt = now + ttl·1000`, and the NoSuchKey/404 → `null` download all moved
  **verbatim**. After this slice the adapter is the **only** module that imports
  `@aws-sdk` — the dev prefix and key/URL schemes are adapter details now.
- **DB-free wiring — the load-bearing constraint.** `lib/r2.ts` is imported by
  five widely-spread modules (the embroidery pipeline, the upload route, the
  supply-feed worker job, the supply-feed reader, the download-links route), and
  it had **zero** Mongo coupling before. Routing the shim through the DB-backed
  `container.ts` (which imports `MongoUserRepository` → `lib/mongodb.ts`, which
  connects/throws at import) would drag Mongo into every one of those import
  sites — a regression. So the port is wired in a **DB-free**
  `composition/object-store.ts` (`getObjectStore()`, a stateless `R2ObjectStore`
  singleton), the exact same no-Mongo-at-import reasoning as `composition/content.ts`.
  `R2ObjectStore` needs no Mongo — only the R2 env vars.
- **`lib/r2.ts` became a thin shim; the five consumers are untouched.** Each
  exported function (`publicUrlFor` → `.publicUrl`, `uploadToR2` → `.upload`,
  `generatePresignedDownloadUrl` → `.presignedDownloadUrl`, `downloadFromR2` →
  `.download`) keeps its exact historical signature and one-line-delegates to
  `getObjectStore()`, so all five callers stay byte-for-byte unchanged and the
  `@aws-sdk` imports left `lib/r2` entirely. The shim stays until those
  workflows migrate behind the port in their own slices (the supply-feed and
  embroidery slices) — no drive-by rewiring here.
- **Pure logic extracted and tested; the S3 sends are not.** `applyEnvPrefix`
  (dev vs not), `buildPublicUrl(base, key)` (trailing/leading slash + prefix),
  and `contentDispositionFor(filename)` (double-quote stripping) are exported
  pure functions covered by 11 unit tests with no S3 — that's the testability
  payoff. The `upload`/`download`/`presignedDownloadUrl` `send()` calls are thin
  pass-throughs to the AWS SDK and are **not** unit-testable without an
  integration/network harness; by design no real-network test was added.

Notes from the SupplyFeedSource slice (the driven-port layer of the supply-feed worker — the orchestrator stays flat for the next slice):

- **The risky orchestrator was deferred on purpose; only the vendor-source layer
  moved.** `RefreshSupplyFeeds` is large — 7 active vendor pulls, a compile module,
  and a ~260-LOC orchestrator carrying a mutual-exclusion flag, dev-disk snapshot
  writes, `skipPulls`/`onlyVendor` options, an R2 read-back compile, and the
  throw-if-all-failed rule. Migrating it whole would be a big, high-risk change to
  a **live cross-vendor pricing feed**. So this slice took just the bottom edge:
  define the `SupplyFeedSource` port (`application/ports/supply-feed-source.ts` —
  `{ readonly name; pull(): Promise<unknown> }`, shaped to *exactly* what the
  orchestrator's loop and `onlyVendor` filter consume) and put the 7 vendor pulls
  behind it. The orchestration itself — the flag, `archiveVendor`,
  `loadCompileInputFromR2`, `compileFeeds`, snapshots, options, failure handling,
  every log line — is **byte-for-byte unchanged** and becomes the next slice.
- **Wrap, don't rewrite — parsers stay byte-identical, the slice stays low-risk.**
  Each adapter (`GunnoldFeedSource` … `OhmycraftyFeedSource` in
  `infrastructure/supply-feed/`) imports the unchanged
  `jobs/sources/<vendor>-pull` and exposes it as `{ name, pull }`. No parsing
  logic moved; the `*-pull.ts` files stay put (relocating them into
  infrastructure is a deferred cleanup). The pulls are the uniform
  `() => Promise<…PullResult>` shape the old `VENDORS` array implied, so all 7
  wrapped cleanly — no fallback to a single pattern-setter was needed.
- **DB-free composition, order is behavior-bearing.** `composition/supply-feed.ts`
  (`getSupplyFeedSources()`) returns the 7 active sources in the **exact order**
  the old inline `VENDORS` literal used — the order matters because the
  orchestrator maps `Promise.allSettled` outcomes back to vendors positionally and
  the `onlyVendor` filter walks the same list. The sources only fetch/parse (no
  Mongo), and the job's R2 writes already reach R2 through the DB-free
  `composition/object-store.ts`, so this composition is DB-free too (mirrors
  `object-store.ts` / `content.ts`; the Mongo container would drag `mongodb.ts`'s
  connect-at-import into the worker for nothing). The Hab+Dash auth-gating comment
  (anonymous-without-creds) and the madeirausa "not implemented" exclusion both
  moved to the composition verbatim — madeirausa stays out exactly as it was
  commented out before.
- **The orchestrator's rewire is one line.** It dropped its 8 `pull*` imports +
  the 7-entry inline literal and now does `const VENDORS = getSupplyFeedSources()`;
  `SupplyFeedSource[]` satisfies the existing
  `Array<{ name: string; pull: () => Promise<unknown> }>` annotation, so nothing
  downstream changed. 25 new tests: each adapter exposes the right `name`,
  `pull()` delegates to the wrapped parser (mocked — no network) and passes its
  resolved value (and rejections) through; `getSupplyFeedSources()` returns the 7
  expected names in the expected order and excludes madeirausa.

Notes from the RefreshSupplyFeeds slice (the orchestrator lifted whole; the supply-feed worker is now on the hexagon):

- **The risky orchestrator finally moved — verbatim, behind injected seams.** The
  vendor-source slice deliberately deferred this ~260-LOC orchestrator because it
  fronts a **live cross-vendor pricing feed**; with `SupplyFeedSource` and
  `ObjectStore` already in place, lifting it became low-risk. `RefreshSupplyFeeds`
  (`application/use-cases/supply-feed/refresh-supply-feeds.ts`) holds the *exact*
  orchestration the flat `runRefreshEmbroiderySupplies` did — `archiveVendor`,
  `loadCompileInputFromR2`, `archiveDerived`, the `Promise.allSettled` +
  positional failure mapping, the throw-only-when-every-attempted-pull-failed
  rule, the `skipPulls`/`onlyVendor` branches (incl. the no-match early
  `{ status: "ok" }` return), the two archive keys per vendor
  (`current.json` + `archive/<YYYY-MM-DD>.json`), the three derived feeds
  (`products/current.json`, `listings/current.json`, `listings/current.csv` —
  **the code, not the file's stale "details/pricing" header comment**), and
  **every `console.log`/`console.error` line** moved byte-for-byte. `archiveVendor`/
  `loadCompileInputFromR2`/`archiveDerived` are now private closures inside the
  use-case module.
- **The mutual-exclusion flag stayed process-wide via a singleton.** The old
  module-level `let isRunning` became a closure-captured flag inside
  `createRefreshSupplyFeeds`. Composition (`getRefreshSupplyFeeds()`) memoizes the
  use-case as a **process-wide singleton**, so the cron and the manual-refresh
  route share the *one* flag exactly as they shared the old module boolean — a
  concurrent overlap still returns `{ status: "busy" }`. Unit-tested by holding
  the first run inside `execute()` on a pull promise and asserting the second call
  is busy.
- **Two new consumer-defined seams, both keeping behavior in the adapter.**
  `LocalSnapshotSink` (`write(relativePath, bytes)`) fronts the dev-disk mirror —
  the **dev-gating lives in `DiskLocalSnapshotSink`** (`NODE_ENV === "development"`
  check + `mkdir -p` + `process.cwd()` join + the snapshot log line, all verbatim),
  so the use-case is env-agnostic and a fake sink records calls without ever
  touching disk. `FeedCacheInvalidator` (`invalidate()`) fronts the end-of-run
  cache drop; `FeedReaderCacheInvalidator` delegates to the unchanged
  `invalidateFeedCache`. Both are injected so the test can assert the snapshot
  writes (vendor `current.*` + the three derived feeds) and the single
  invalidation fire.
- **`compileFeeds` and `VENDOR_NAMES` are injected, not imported into the
  use-case body — for testability and to leave `compile-feeds.ts` untouched.** The
  compiler does `readFileSync` on bundled Ink/Stitch palette files, so it stays in
  `compile-feeds.ts` exactly as-is; the use-case takes it as a
  `(input: CompileInput) => CompileResult` dep and `VENDOR_NAMES` as a
  `readonly string[]`. Composition passes the real ones; the test passes a `vi.fn`
  fake and a two-vendor name list, so the orchestration is exercised with no
  palette loads. The route still imports `VENDOR_NAMES` from `compile-feeds`
  directly for its `?vendor=` validation — unchanged.
- **DB-free wiring, one-line driver rewire.** `getRefreshSupplyFeeds()` lives in
  the already-DB-free `composition/supply-feed.ts` (composing
  `getSupplyFeedSources()` + `getObjectStore()` + the two new adapters + the
  injected compiler) — no Mongo, mirroring `object-store.ts`/`content.ts`.
  `refresh-embroidery-supplies.ts` shrank to a thin wrapper that re-exports
  `RefreshResult` and one-lines `getRefreshSupplyFeeds().execute(options)`, so
  **both callers are byte-for-byte unchanged**: `src/worker/index.ts`'s cron
  (schedule/timezone/try-catch/`shuttingDown` guard intact) and the manual-refresh
  route (auth → `?compile`/`?vendor` parsing → 409/200/500 mapping intact). 10 new
  tests against fakes: busy overlap, all-fail throws (and never compiles), partial
  failure still compiles + writes the 3 derived feeds (with the survivor's R2
  read-back as compile input), `skipPulls` compiles without pulling, `onlyVendor`
  narrows to one, the no-match early `{ status: "ok" }` + error log (+ flag
  cleared), the 3 derived feeds' keys/content-types, the single cache
  invalidation, and the dev-snapshot calls.

**The supply-feed worker subsystem is now fully on the hexagon** — vendor pulls
behind `SupplyFeedSource`, R2 writes behind `ObjectStore`, and the orchestrator a
DB-free use-case driven by a thin cron scheduler + a thin manual-refresh route.
The only deferred cleanup is the verbatim relocation of the 7 `jobs/sources/*-pull.ts`
parser files into `infrastructure/supply-feed/` (they stay wrapped, not moved —
relocating them would touch `compile-feeds.ts`'s type imports and the 7 existing
feed-source adapters for zero behavior gain, ballooning the slice). `compileFeeds`
itself stays in `compile-feeds.ts` (palette `readFileSync` and all), injected as a
pure-ish helper.

Notes from the EmbroideryComputeGateway slice (the first embroidery-pipeline sub-slice — the Python-service HTTP client behind a driven port):

- **The clean bottom edge of the big pipeline moved first.** The embroidery
  pipeline is the largest remaining subsystem (orchestrator + AI palette/tag +
  Python compute + auth + quota), so it gets sliced bottom-up. `_lib/worker.ts`
  is its cleanest edge — a self-contained HTTP client whose `node:http` machinery
  is fully private and whose 3 exported functions take/return plain values
  (`Uint8Array` + strings/numbers/arrays in; `Uint8Array` / a plain
  `SampledColors` object out). No consumer touches raw `http`/`Response` types,
  so the `EmbroideryComputeGateway` port is **clean** (like `ObjectStore`, unlike
  the OpenAI client). This is purely a driven-port inversion — no driving
  adapter, no use-case — exactly the `ObjectStore`/`Cache` shape. The
  orchestrator (`pipeline.ts`), the LLM-coupled AI palette/tag (`ai/*`), and
  auth/quota are explicitly **later** sub-slices and were left flat.
- **`node:http` moved verbatim — switching to `fetch` is the bug.** The
  15-minute socket timeout is load-bearing: Ink/Stitch runs ~5–10 min, which
  exceeds undici fetch's default 5-min headers timeout, so `HttpEmbroideryWorker`
  keeps using `node:http`/`node:https` directly with its own
  `req.setTimeout(WORKER_TIMEOUT_MS, …)` destroy. The `WORKER_URL` default
  (`http://localhost:8080`), the protocol/port selection, the header names, the
  `<200 || >=300` rejection, the 500-char error-body slice, and the
  `timed out after Nms` message all moved byte-for-byte. After this slice the
  adapter is the **only** module that knows the Python service URL or speaks
  `node:http` to it.
- **The querystring builders are pure, exported, and tested; the send is not.**
  Mirroring how `R2ObjectStore` extracted `buildPublicUrl`, the trace and
  sample-colors param construction became `buildTraceQuery(...)` /
  `buildSampleColorsQuery(...)` — pure, no I/O — so every encoding rule is
  unit-tested without a live server: `size`/`colors` stringification, the palette
  `#`-stripping + comma-join (and the empty-array omission), `extract_outline`
  `"1"`/`"0"` (default `"1"`), the routing **clusters.length > 0 AND
  clusters.length === routes.length** guard (with `#`-stripped clusters), the skip
  indices, the `n` default of 20, the `full_res` flag, and the optional `size`
  hint. The `workerPost` `node:http` send (and `convert`'s trivial `?size=`
  query) is a thin pass-through to the Python service and is **not** unit-testable
  without a live server — by design no real-network test was added. 17 new tests
  (15 builder + 2 `WorkerError`).
- **`WorkerError`'s class identity is preserved — defined once, re-exported
  twice.** The two generate routes catch failures via `instanceof WorkerError &&
  err.status === 503`, so `WorkerError` is defined **once** in the port module
  (`application/ports/embroidery-compute-gateway.ts`) and re-exported through both
  `HttpEmbroideryWorker` and the `_lib/worker.ts` shim — never redefined. A test
  asserts `shim.WorkerError === port.WorkerError` so the routes' `instanceof`
  can't silently break. The contract types (`ClusterRouting`, `SampledColor`,
  `SampledColors`) live in the port too and are re-exported through the shim, so
  `select-palette.ts`'s `SampledColors` *type* import is unchanged.
- **DB-free wiring, the load-bearing constraint (again).** `_lib/worker.ts`
  imported only `node:http` — **zero** Mongo coupling — and is reached by
  `pipeline.ts`, both generate routes, and `select-palette.ts`. Routing the shim
  through the DB-backed `container.ts` (which imports `MongoUserRepository` →
  `mongodb.ts`, which connects/throws at import) would drag Mongo into all of
  those for nothing — a regression. So the port is wired in a **DB-free**
  `composition/embroidery-compute.ts` (`getEmbroideryComputeGateway()`, a
  stateless `HttpEmbroideryWorker` singleton), the same reasoning as
  `object-store.ts` / `content.ts`. `_lib/worker.ts` became a thin shim — the 3
  functions keep their exact signatures + defaults and one-line-delegate to the
  singleton — so `pipeline.ts`, both routes, and `select-palette.ts` are
  byte-for-byte unchanged. A `FakeEmbroideryComputeGateway`
  (`application/ports/embroidery-compute-gateway.fake.ts`, recording, no-network)
  is staged for the later `RunEmbroideryPipeline` use-case test.

Notes from the embroidery quota slice (a pure-domain extraction — like `parseBlogPost` / `sortProjects`, not a port/use-case):

- **The rule was already pure, so this is a relocation, not a rewrite.**
  `_lib/quota.ts`'s `computeQuota` did **zero I/O** — the caller passes in the
  user's already-read `Generation[]` and an optional `now`/`unlimited` — so it
  belongs in `domain/`, not behind a port. The whole module
  (`computeQuota` + the `Quota` interface + the `MONTHLY_LIMIT` /
  `WINDOW_DAYS` / `WINDOW_MS` constants) moved **verbatim** to
  `domain/embroidery/quota.ts`; the only addition is a doc comment naming it a
  pure rule (the 20-per-rolling-30-days quota policy). The `Generation` *type*
  import from `@/types/user` is fine — it's a plain data type, no I/O. This is
  the same shape as the earlier `ProjectCaseStudy`/`BlogPost` type moves and the
  `sortProjects`/`parseBlogPost` rule moves.
- **Behavior preserved byte-for-byte** — the strict-less-than window comparison
  (`now - createdAt < WINDOW_MS`, so a generation *exactly* `WINDOW_MS` old is
  **not** in-window), the `>= MONTHLY_LIMIT` threshold, the `unlimited`
  short-circuit (which suppresses both `exceeded` and `nextResetAt`), the
  oldest-in-window sort for `nextResetAt`, the `createdAt` parsing, and the
  returned field order are all identical. The `now` parameter keeps its
  `Date.now()` default; the test passes `now` explicitly for determinism.
- **Direct repoint, no shim — there's no I/O or DI to invert.** All four
  importers — `/api/embroidery/generate`, `/embroidery/api/generate-from-url`,
  the `/embroidery` page, and the client `ImageUploader.tsx` (type-only) — moved
  their import to `@/domain/embroidery/quota` and `_lib/quota.ts` was deleted
  outright (no shim, unlike the `worker.ts`/`r2.ts` driven-port slices, which
  needed a delegating shim because they front real I/O). The **route-level quota
  *orchestration*** (reading `user.generations`, the `unlimited` allow-list, the
  429 response) stays flat in the generate routes — it migrates later with the
  `RunEmbroideryPipeline` use-case.
- **`_lib/auth.ts` needed no change** — it's already a thin `requireAuth` wrapper
  over the migrated `AuthenticateRequest` (slice 8), so the quota move didn't
  touch it. 7 new unit tests: empty → `{ used: 0, exceeded: false, nextResetAt:
  null }`, out-of-window exclusion, the strict boundary (exactly `WINDOW_MS` old
  is out), just-under-limit not-exceeded, exactly-at-limit exceeded with
  `nextResetAt = oldest-in-window + WINDOW_MS`, oldest-pick regardless of input
  order, and `unlimited` past the limit (never exceeds, null reset). No disk, no
  clock dependence.

Notes from the embroidery geometry-libs slice (a pure-domain relocation — like the quota slice; the inkstitch trio deferred for a fragile `.gpl` load):

- **Eight pure geometry files moved verbatim; intra-lib imports never changed.**
  `path-parser`, `enclosure`, `prefilter`, `metrics`, `analyze-svg`, the
  `index.ts` barrel, `types`, and `strip-paths` all do pure SVG path math /
  string parsing with **zero I/O**, so they belong in `domain/`, not behind a
  port — the same shape as `computeQuota`/`parseBlogPost`/`sortProjects`. They
  moved as a **cohesive subfolder** to `domain/embroidery/geometry/`, so every
  `./types`/`./analyze-svg`/`./prefilter` relative import inside the lib stayed
  byte-identical (the whole unit relocated together). The geometry barrel had
  exactly **two** importers — `_lib/inkstitch/apply-attrs.ts` (a `PathRecord`
  *type* import) and `_lib/ai/tag-svg.ts` — both repointed to
  `@/domain/embroidery/geometry` with a one-line edit. `tag-svg.ts` is an
  un-migrated AI file; only its **import path** changed, no logic (the same
  "touch one line of an un-migrated file to finish a move" precedent as the
  quota/EmbroideryComputeGateway slices). `_lib/geometry/*` was then deleted
  outright (no shim — there's no I/O or DI to invert).
- **The Ink-Stitch trio was deferred on purpose — the `.gpl` load is fragile.**
  Of `inkstitch/`'s three files, `apply-attrs.ts` and `thread-palette.ts` are
  pure, but `gpl-palette.ts` does the one real I/O in the whole geometry/inkstitch
  surface: it `readFileSync`s the bundled Ink/Stitch `.gpl` palette catalog. It
  resolves each file with `new URL("./palettes/<file>.gpl", import.meta.url)` —
  **relative to the file's own location**, not `process.cwd()` — and the module's
  own comment is explicit that **Turbopack can only emit and resolve those sibling
  assets when the URL string is statically analyzable** (a computed `${file}`
  collapsed every palette to the first alphabetical match in an earlier bug). To
  move `gpl-palette.ts` into the domain behavior-preservingly, its 75 sibling
  `.gpl` data files would have to move *with* it (so `import.meta.url` + the
  Turbopack asset emission still resolve), and three dev/build scripts
  (`build-thread-color-map.mjs`, `crawl-thread-images.mjs`, `extract-sulky-rgb.mjs`)
  plus `API.md` that hardcode `src/app/embroidery/_lib/inkstitch/palettes` would
  need repointing — none of which is covered by `npm test`/`tsc`, so the
  Turbopack emission couldn't be verified green here. That's the documented
  "fragile `.gpl` path" fallback: relocate the cohesive geometry subset this
  slice, defer the inkstitch trio (`apply-attrs` + `thread-palette` +
  `gpl-palette`) to a follow-up that moves the file *and* its `palettes/` sibling
  dir together and repoints the scripts. `gpl-palette.ts` stays put, so the four
  palette routes (`/api/embroidery/palettes` + `[manufacturer]`,
  `/embroidery/api/palettes` + `[manufacturer]`), `pipeline.ts`, and
  `ai/select-palette.ts` are **untouched** and the bundled `.gpl` files load
  identically.
- **22 new pure tests, no I/O.** `path-parser` (transform composition, abs/rel
  commands, implicit-lineto-after-moveto, close-path point, the 16-step cubic /
  12-step quad flatten counts, the starts-with-a-number throw), `metrics` (the
  shoelace area sign convention, holes subtracting, empty-input guards, the
  OBB length ≥ width invariant), and `enclosure` (the same-color-only,
  larger-encloses-smaller, case-insensitive, no-overlap, unmapped-record rules)
  are exercised directly against in-memory data — the easiest testability win in
  the codebase, exactly as [`embroidery.md`](embroidery.md) predicted.

Notes from the LlmGateway + embroidery AI slice (the long-deferred keystone — the OpenAI client finally behind a port):

- **One uniform call, one focused port method.** The two embroidery AI calls
  were designed (upstream of this slice) to be **uniform**: both do a
  `chat.completions.create` with `model: "gpt-5.4-mini"`, `response_format:
  { type: "json_object" }`, a system message plus a user message whose content
  is `[{ type: "text", text }, { type: "image_url", image_url: { url, detail:
  "high" } }]`, **no tools, no streaming**, and both read
  `response.choices[0]?.message?.content ?? ""` then `JSON.parse` it. They differ
  only in **temperature** (`select-palette` 0, `tag-svg` 0.2) and the prompt
  text. So the port (`application/ports/llm-gateway.ts`) gets **one** consumer-
  defined, domain-shaped method — `generateJsonFromImage({ model, temperature,
  systemPrompt, userText, imageUrl }) → Promise<string>` — that serves both with
  **no OpenAI types across the boundary** (unlike the still-flat chat loop, which
  is coupled to OpenAI message/tool types). The `json_object` response_format and
  the image detail `"high"` are documented as part of the method's contract —
  both callers rely on them.
- **The adapter builds the exact call, verbatim.** `OpenAiChatGateway`
  (`infrastructure/llm/openai-chat-gateway.ts`) constructs precisely the
  `create()` both consumers issued today — same `model`, `response_format`,
  `temperature`, and the `system` + `(text, image_url@high)` user message — and
  returns `choices[0]?.message?.content ?? ""`. It is the **sole `openai`-SDK
  touch on the embroidery-AI path** now. It reuses `getOpenAI()` from
  `@/lib/ai/client` for the client (one `OPENAI_API_KEY` read), and **`client.ts`
  stays in place** because the chat tool-loop (`ai/chat.ts`) still imports it —
  full SDK isolation waits for the final chat slice.
- **DB-free wiring (again the load-bearing constraint).** The LLM calls need no
  Mongo, and `mongodb.ts` connects/throws at import, so the gateway is wired in a
  DB-free `composition/llm.ts` (`getLlmGateway()`, a stateless `OpenAiChatGateway`
  singleton), mirroring `composition/object-store.ts` /
  `composition/embroidery-compute.ts`. The two consumers reach it via
  `import { getLlmGateway } from "@/composition/llm"` and **stay as the flat
  functions `selectPalette` / `askOpenAI`** — the established incremental
  shim/repoint pattern. They are not lifted into use-cases this slice (that's the
  `RunEmbroideryPipeline` slice); only the LLM call moved behind the port.
- **The consolidation logic is now unit-tested — the real payoff.** `selectPalette`
  drops its inline `getOpenAI()` + `create()` for one
  `getLlmGateway().generateJsonFromImage(...)`, keeping the `JSON.parse` and
  **all** the downstream Lab-merge / cap / routing consolidation byte-for-byte.
  Against a recording `FakeLlmGateway`
  (`application/ports/llm-gateway.fake.ts`), 10 tests assert (a) the request it
  builds — `model` `gpt-5.4-mini`, `temperature` 0, `systemPrompt`
  `SELECT_PALETTE_SYSTEM_PROMPT`, `imageUrl` = `pngUrl`, and a `userText` carrying
  MAX_THREADS + the thread table — and (b) the adaptive Lab-ΔE merge (near-
  duplicate picks fuse, higher-coverage wins, routes follow), the cap drop
  (lowest-routed rep dropped, its cluster rerouted to the nearest-Lab survivor,
  no `-1` fallback), the unrouted-cluster `-1` fallback, the pick dedup/drop-
  unknown rules, the `< 2 picks` throw, the missing-`picks` throw, and the
  `extract_outline` default. This is the deterministic test of the Lab-merge/cap
  logic that the live tool never had. `tag-svg`'s `askOpenAI` migrated the same
  way (temperature 0.2 + `TAG_SVG_SYSTEM_PROMPT`, keeping the `paths`-array
  validation + return); its 2 tests run the real `analyzeSvg` geometry on a tiny
  SVG and assert the request shape + the canned-`paths` mapping (and that a
  confident-only SVG short-circuits the AI call) — no network either.
- **Behavior preserved exactly.** Identical model, temperatures (0 / 0.2),
  `json_object` response_format, system+user message structure, the user-text
  strings (built verbatim), `image_url` detail `"high"`, and the
  `choices[0].message.content ?? ""` extraction. `chat.ts`, `conversations.ts`,
  and `pipeline.ts` are **untouched**.

Notes from the RunEmbroideryPipeline slice (the embroidery-pipeline keystone — the generate orchestrator lifted whole behind its ports):

- **The whole orchestration moved verbatim; the seam was a thin wrapper.** With
  the four collaborators already inverted in earlier sub-slices —
  `EmbroideryComputeGateway` (Python compute), `ObjectStore` (R2), the
  `LlmGateway`-backed AI (`selectPalette`/`tagSvg`), the `domain/embroidery/quota`
  rule, and the `domain/embroidery/geometry/*` pure libs — lifting the ~389-LOC
  `runPipeline` into `RunEmbroideryPipeline`
  (`application/use-cases/embroidery/run-embroidery-pipeline.ts`) became
  low-risk. The body is **byte-for-byte the old orchestration**: identical stage
  sequence (persist input.png → sampleColors → palette → persist palette.json →
  trace → persist traced.svg → tagSvg → persist cleaned/geometry/tagged →
  convert → persist out.zip → extract + persist embroidery.bmp), every
  `step()`/`plog()`/`perr()` log line, the background-role skip-index
  computation, the best-effort `sampleColors` `.catch`, the artifact names +
  content types + R2 keys (`embroidery/<customerId>/<hash>_<size>/…`), the local
  `tmp/embroidery` writes + ZIP extraction + the `embroidery.bmp` publish, and
  the returned `PipelineResult`. `_lib/pipeline.ts` shrank to a thin wrapper —
  `runPipeline` one-lines `getRunEmbroideryPipeline().execute(...)` — so **all
  three generate routes are byte-for-byte unchanged** (they still import
  `runPipeline` + the validators), and so are the `convert`/`sizes` routes that
  import `ALLOWED_SIZES`/`validateSize`.
- **`SKIP_AI_PALETTE = true` preserved verbatim — behavior-preserving means the
  AI palette stays skipped.** The debug toggle (a module const, value `true`, the
  same `{ threads: [], extractOutline: true, routing: null, rationale: "AI
  palette skipped via SKIP_AI_PALETTE debug flag" }` bypass object, the same
  `plog` line) moved unchanged into the use-case. It was **not** flipped — the
  slice preserves the user's current working-tree state. A unit test asserts the
  injected `selectPalette` is never called and `palette.json` carries the
  empty-threads bypass selection. (The toggle's own comment — "Flip back to
  `false` before merge" — also moved verbatim.)
- **A new `LocalArtifactSink` port fronts the last raw I/O — the `tmp/embroidery`
  disk writes.** Modeled on the `LocalSnapshotSink` precedent from the
  RefreshSupplyFeeds slice: the use-case says "ensure the dir, then write these
  bytes under this name," and `DiskLocalArtifactSink`
  (`infrastructure/embroidery/disk-local-artifact-sink.ts`) owns `node:fs` + the
  fixed `path.join(process.cwd(), "tmp", "embroidery")` path **verbatim** (the
  old `mkdir -p` + `writeFile(path.join(localDir, name), bytes)`). It exposes
  `localDir` so `PipelineResult.localDir` is echoed identically. The old
  `persist()` helper became `objectStore.upload(...)` + `localArtifacts.write(...)`;
  the ZIP-extract loop and the `embroidery.bmp` persist both go through the same
  sink, so the disk writes (incl. the double-write of `embroidery.bmp` — once as
  an extracted entry, once via persist) are preserved.
- **The pure value-objects + byte helpers moved to the domain; the routes' import
  paths kept working via re-export.** `validateSize`/`validateCustomerId` + the
  constants (`DEFAULT_COLORS`/`MIN_COLORS`/`MAX_COLORS`/`ALLOWED_SIZES`/
  `TEST_CUSTOMER_ID`) + the errors (`InvalidSizeError`/`InvalidCustomerIdError`)
  + `AllowedSize`, plus the pure `extractZip` (the local-file-header ZIP reader)
  and `hashPng`, moved to `domain/embroidery/pipeline-validation.ts` (the docs
  call these value objects). `_lib/pipeline.ts` **re-exports** the public ones so
  every importer is unchanged; `extractZip`/`hashPng` were always private and
  stay un-exported.
- **`gpl-palette` stays flat/deferred — injected, called transitionally.** The
  bundled-`.gpl` `loadPalette`/`filterAvailable` are the build-fragile piece
  (the `new URL("./palettes/<file>.gpl", import.meta.url)` + Turbopack asset
  emission — see the geometry-slice note), so they're **not** moved this slice;
  they're injected into the use-case as functions and the composition passes the
  real ones. This keeps the use-case unit-testable (a fake palette stands in)
  without touching the fragile load.
- **DB-free wiring, the load-bearing constraint (again).** The pipeline touches
  **no Mongo** — generation persistence stays flat in the routes via `lib/users`
  (`appendGeneration`/`appendApiGeneration`) — and `src/lib/mongodb.ts`
  connects/throws at import. So `RunEmbroideryPipeline` is wired in a DB-free
  `composition/embroidery-pipeline.ts` (`getRunEmbroideryPipeline()` singleton),
  composing `getEmbroideryComputeGateway()` + `getObjectStore()` +
  `selectPalette`/`tagSvg` + `loadPalette`/`filterAvailable` + a
  `DiskLocalArtifactSink`, mirroring `embroidery-compute.ts` / `object-store.ts`
  / `llm.ts`. 9 new tests against the staged fakes (`FakeEmbroideryComputeGateway`
  + a fake `ObjectStore` + a fake `LocalArtifactSink` + fake `selectPalette`/
  `tagSvg`/`loadPalette`/`filterAvailable`, building a real STORED-method ZIP so
  the pure `extractZip` runs): stage order + the full persisted artifact set to
  **both** the object store and the disk sink (with exact content types + R2
  keys), the `PipelineResult` shape (incl. `colors` clamp + the urls map), the
  best-effort `sampleColors` `.catch` continuing, the SKIP_AI_PALETTE bypass, the
  missing-`embroidery.bmp` warn path, and the validators' accept/reject. No
  network, no real disk.
- **Route-level quota/auth stays flat** — the `requireAuth` gate, the
  `computeQuota` orchestration (reading `user.generations`/`api_generations`, the
  `unlimited` allow-list, the 429), the in-flight lock, the dedup, and the
  `WorkerError && status === 503 → 429` mapping are unchanged in all three
  routes. `_lib/auth.ts` is already a thin `requireAuth` wrapper — untouched.

**The embroidery pipeline is now on the hexagon** — the orchestrator is a DB-free
use-case behind `EmbroideryComputeGateway` / `ObjectStore` /
`LlmGateway`-backed-AI / the new `LocalArtifactSink`, driven by the thin
`runPipeline` wrapper so the three generate routes are unchanged. What's left
flat in the embroidery surface: the **inkstitch trio** (`apply-attrs` +
`thread-palette` are pure; `gpl-palette` is the deferred bundled-`.gpl` load),
the **route-level quota/auth orchestration**, and **generation persistence**
(`lib/users`).

Notes from the chat-loop slice (the FINAL subsystem — the OpenAI SDK now fully isolated):

- **One new gateway method served both calls, and it's the crux of the slice.**
  The chat loop and the title summarizer are both `chat.completions.create`
  calls, so rather than two port methods `LlmGateway` gained **one** —
  `createChatCompletion(request) → result` — with **domain-shaped DTOs** so
  `chat.ts` (and now the use-cases) never touch an OpenAI type. The request is
  `{ model, temperature, maxCompletionTokens, messages, tools?,
  responseFormatJson? }`; `messages` is a `ChatMessage` union
  (`system` / `user` / `assistant`-with-optional-`toolCalls` / `tool`-with-
  `toolCallId`), `tools` is a `ToolSchema[]` structurally matching `registry.ts`'s
  `toolSchemas` (so they **pass through unchanged** — the registry was not
  touched), and the result is `{ hasChoice, content, toolCalls, finishReason }`.
  The summarizer uses the *same* method with `responseFormatJson: true`, no tools,
  `maxCompletionTokens` 60, `temperature` 0.3, and reads `result.content`.
- **The bidirectional tool_call round-trip is the load-bearing mapping.** The old
  loop pushed the **raw** `choice.message` back into `messages` and appended
  `role: "tool"` messages addressed by `tool_call_id`; the next `create()` saw the
  assistant's tool_calls plus their results. To preserve that with no OpenAI types
  leaking, the use-case pushes a domain `{ role: "assistant", content,
  toolCalls }` then `{ role: "tool", toolCallId, content }` messages, and
  `OpenAiChatGateway` maps `ChatMessage[] → ChatCompletionMessageParam[]`
  (re-attaching `tool_calls` on the assistant message, `tool_call_id` on the tool
  message) on the way in and `choice.message → { content, toolCalls,
  finishReason }` on the way out. The `tc.type !== "function"` branch is
  preserved via the domain `ToolCall.type` (`"function" | "other"`): an `"other"`
  call still gets the "Unsupported tool call type" tool message and is never
  re-attached. `hasChoice: false` preserves the old `if (!choice) break;` —
  no choice abandons the loop and returns the **fallback**, not an empty answer.
- **Full SDK isolation — `client.ts` is gone.** After slice 20 only
  `chat.ts` and `client.ts` still imported `openai`. `chat.ts` now routes both
  calls through the gateway and **dropped `import OpenAI`**; with `chat.ts` no
  longer importing `getOpenAI`, `src/lib/ai/client.ts` had no consumers, so the
  per-request client construction moved verbatim into `OpenAiChatGateway`'s
  private `getClient()` and `client.ts` was **deleted (plain filesystem delete)**.
  `OpenAiChatGateway` is now the **sole `import OpenAI from "openai"` in the app**
  — exactly the dependency-inversion payoff the port was introduced for; a
  provider swap is one new adapter.
- **Full lift, not a carve — use-cases + a new `ConversationStore` port.**
  `runAssistantTurn`/`summarizeAndSetTitle` became `RunAssistantTurn` /
  `SummarizeConversationTitle` (`application/use-cases/chat/`), and the two Mongo
  writes the loop/titler perform (`appendMessage`/`setTitle`) went behind a new
  consumer-defined `ConversationStore` port → `MongoConversationStore` (wraps the
  **unchanged** `lib/ai/conversations` writes). The **read side** of
  `lib/ai/conversations` (create / fetch / list / claim / delete) stays flat in
  the chat routes — only the two writes inverted. `ConversationMessage` /
  `ToolResultPayload` moved to `domain/chat/conversation-message.ts` and are
  **re-exported from `conversations.ts`**, so the routes' imports are byte-for-byte
  unchanged. `resolvePageContext` (which reads the DB-free content container for
  blog/project context) lifted **verbatim** to `composition/chat-page-context.ts`
  and is injected, keeping the use-case testable with a fake; `dispatchTool` +
  `toolSchemas` are injected from the unchanged `registry.ts`.
- **Wired in the DB-backed `container.ts`, driven by an unchanged thin
  `chat.ts`.** The chat loop needs Mongo (the conversation store), and the only
  caller (`POST /api/chat`) is a dynamic route that already touches Mongo, so the
  use-cases live in the full `createContainer()` and reuse the DB-free
  `getLlmGateway()` singleton. `chat.ts` shrank to two wrappers — `runAssistantTurn`
  / `summarizeAndSetTitle` keep their exact signatures (still taking the route's
  `ObjectId` id), convert the id to a string, and one-line-delegate to the
  container — so **`POST /api/chat` is byte-for-byte unchanged**, and the other
  three chat routes (which never imported `chat.ts`) are untouched too.
- **12 new tests against fakes, no network.** Against the extended `FakeLlmGateway`
  (a scriptable `chatResponses` FIFO) + a `FakeConversationStore`: the loop
  dispatches a tool_call → appends the tool result → loops → returns the final
  assistant message with `toolResults` (and the second request carries the
  assistant tool-call turn + matching tool result in order — the round-trip), the
  4-iteration cap returns the fallback (with the accumulated tool results), a
  no-tool response returns immediately and persists, a thrown dispatch emits an
  error tool message but is **not** added to `toolResults`, the unsupported-type
  branch answers without dispatching, no-choice falls through to the fallback, and
  the prompt/window/params (system + page-context + windowed history, model/temp/
  tokens/tools) are built verbatim. The titler tests assert the JSON-object
  request params, the `{ title }` parse + trim + clamp(60), and the
  `"New conversation"` fallbacks (unparseable / empty / null content) — `setTitle`
  called with the right id + value each time.

**The chat-assistant subsystem is now on the hexagon, and the OpenAI SDK is fully
isolated** — both the chat tool loop and the embroidery-AI path go through
`LlmGateway` → `OpenAiChatGateway`, the only `openai` importer in the app. The
read side of `lib/ai/conversations` (and `getCachedSession`, the chat routes'
session helper) stays flat — both are shared, hot-path helpers whose remaining
consumers are still-flat routes; they migrate with those routes, not before.

Candidate next slices (the migration is complete — the final audit pass has run;
see the Status note at the top of *Progress*):

1. **Final audit pass — done (2026-05-31).** With contact, auth, content, the
   supply-feed worker, the embroidery pipeline, and the chat loop all on the
   hexagon, the big subsystems are done. The audit confirmed the layer/dependency
   rules hold (no `app/` → `infrastructure/` shortcut, no use-case importing a
   concrete SDK; every SDK behind a port) and reconciled the docs with the code.
   The small shared helpers deliberately left flat — `getCachedSession`
   (`lib/auth`), the read side of `lib/ai/conversations`, `lib/cache` (the one
   shared store), `lib/users` (generation persistence + the repo impls the
   adapters wrap), and the wrapped-but-not-moved `lib/indexnow*` / `lib/r2` /
   `jobs/sources/*-pull` shims — are all confirmed intentional under the
   "delete a shared lib only when its LAST consumer migrates" rule. One minor
   nit the audit surfaced (not a blocker): `RunAssistantTurn` imports the
   pure-data constants `SUPPLY_DEFAULT_TOLERANCE` / `SUPPLY_TOLERANCE_RETRY_LADDER`
   from `@/lib/ai/embroidery-supplies/constants` — no I/O, no SDK, but strictly an
   `application` → `lib` import; a tidy-up slice could relocate those shared
   tolerance constants into `domain/` (the `find_thread_color` supply tool reads
   them too).
2. **Ink-Stitch trio → domain** (`_lib/inkstitch/apply-attrs.ts` +
   `thread-palette.ts` + `gpl-palette.ts`). The remaining embroidery cleanup:
   `apply-attrs`/`thread-palette` are pure, but `gpl-palette.ts` is the
   bundled-`.gpl` `readFileSync` via `new URL("./palettes/<file>.gpl",
   import.meta.url)` — it must move **together with its `palettes/` sibling dir**
   (to keep `import.meta.url` + Turbopack asset emission resolving) plus a
   repoint of the three dev scripts + `API.md` that hardcode the old palette dir,
   and it needs a **`next build` check** (not covered by `npm test`/`tsc`), so
   it's its own slice. Once moved, the use-case's injected `loadPalette`/
   `filterAvailable` can point at the domain copy.
3. **Route-level embroidery quota/auth orchestration** (the three generate
   routes' `computeQuota` read of `user.generations`/`api_generations`, the
   `unlimited` allow-list, the in-flight lock, the dedup, the 429 mapping). This
   would lift the route orchestration into the use-case (or a thin wrapping
   use-case) and likely introduce a `GenerationRepository` port over the
   still-flat `lib/users` persistence. The actor/quota layer, not the pipeline
   itself.

@AGENTS.md

# jawetzel.com

## Project

- **What it is:** a portfolio that doubles as a **host for small live tools** —
  an AI image → machine-ready-stitches embroidery pipeline (browser UI + HTTP
  API), a cross-vendor embroidery-supply pricing feed, a raster → SVG vectorizer,
  and a resume-aware AI chat. The portfolio content is the showcase; the tools
  are the proof.
- **Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4.
  MongoDB for application data; **file-sourced JSON/Markdown** for editorial
  content (no CMS). Cloudflare R2 (blobs), OpenAI (chat + embroidery AI), Brevo
  (email/SMS), Sharp. NextAuth (Google OAuth + magic-link) with per-surface API
  keys. Two background systems: an in-process `node-cron` worker and a separate
  **Python embroidery-compute microservice**. Deployed on Railway. Path alias
  `@/*` → `src/*`.
- **Status:** **shipped and working — and now mid-migration.** The architecture
  documented below is the **target**, and we are moving the code onto it **one
  vertical user-action slice at a time** (behavior-preserving). Migrated slices
  live in the hexagon (`src/domain/`, `src/application/`, `src/infrastructure/`,
  `src/composition/`); everything not yet migrated is still flat (`src/app/` →
  `src/lib/*` → services/workers). See the **Architecture** guard rail for how to
  tell which is which and how to extend it.

## Architecture

> **The migration is in progress — read this before touching code.** The
> [`docs/architecture/`](docs/architecture/overview.md) tree describes the
> **target** (adapted from the sibling project **psychable**, `../psychable`),
> and the codebase is being moved onto it **one vertical user-action slice at a
> time**. Two worlds coexist right now:
>
> - **Migrated slices** live in the hexagon and follow these docs exactly:
>   `src/domain/` (pure rules + value objects + `Result`), `src/application/`
>   (use-cases + consumer-owned `ports/`), `src/infrastructure/` (adapters),
>   `src/composition/` (the `createContainer()` wiring). Driving adapters under
>   `src/app/` resolve use-cases from the container. **Done so far:** the whole
>   email surface — contact (`SubmitContactInquiry`), magic-link sign-in
>   (`RequestMagicLink` / `ConsumeMagicLink`), embroidery-ready notify
>   (`NotifyEmbroideryReady`) — all behind the `EmailSender` port; plus the
>   resume read (`GetResume` behind `ContentSource`), the projects read
>   (`GetAllProjects` / `GetFeaturedProjects` / `GetProjectBySlug` behind
>   `ContentSource.readJsonCollection`, with the cap-of-4 now an explicit,
>   unit-tested rule in `GetFeaturedProjects`), and the blog read
>   (`GetAllPosts` / `GetPostBySlug` / `GetAllTags` / `GetPostsByKind` behind
>   `ContentSource.readJsonCollectionWithNames` with a `"repo-root"` base, since
>   `blog/` lives outside `src/content/`; the filename→date/slug rule is the
>   domain's `parseBlogPost`), and the testimonials + marquee reads
>   (`GetTestimonials` / `GetMarqueeItems` behind the existing
>   `ContentSource.readJson` — single-file array reads, no new port surface,
>   missing-file → [] guard preserved in the use-cases). **Also:** API-key auth —
>   `requireAuth` is now a thin shim over the `AuthenticateRequest` use-case
>   (the three-path resolver, exact order/decisions/401 preserved) behind
>   consumer-defined `SessionGateway` / `ApiKeyVerifier` / `ServiceKeyVerifier`
>   ports (the first slice to put NextAuth fully behind a port). All 13 gated
>   route handlers + the embroidery `_lib/auth.ts` wrapper are unchanged;
>   `hashApiKey` / `apiKeyCacheKey` stay the shared source of truth (in
>   `ApiKeyVerifierAdapter`); `AuthPrincipal` moved to `domain/auth`. **Also:**
>   the API-key **issuer** (`embroidery/_lib/api-key-actions.ts`
>   `issueApiKeyAction`) is now a thin server action delegating to the
>   `IssueApiKey` use-case — it generates the `pwsk_<uuid>`, persists only the
>   HMAC, and rotate-evicts the previous hash through the *same*
>   `ApiKeyVerifier` adapter the validator uses (the port widened with
>   `hash`/`evict`; `UserRepository` widened with `getApiKeyHash`/`setApiKeyHash`),
>   so issuer and validator share one `hashApiKey` and one cache scheme and
>   can't drift. Edge session auth is preserved verbatim at the action
>   (`getCachedSession`; `throw new Error("Unauthorized")`), the `{ apiKey }`
>   return shape is unchanged (so `ApiKeyPanel.tsx` is untouched), and the
>   now-dead `hashApiKey`/`evictCachedApiKey`/`apiKeyCacheKey` re-exports were
>   removed from `api-auth.ts` once the issuer stopped importing them.
>   **Also:** Google sign-in — the NextAuth `signIn` callback's Google branch now
>   delegates provisioning to the `FindOrCreateGoogleUser` use-case (symmetric
>   with the magic-link branch's `ConsumeMagicLink`), resolved from the container;
>   `UserRepository` widened with `findOrCreateGoogleUser(input) → AuthUser`
>   (`MongoUserRepository` wraps the **unchanged** `lib/users.findOrCreateGoogleUser`
>   and maps `User` → `AuthUser`). The sign-in gate is byte-identical (provider /
>   `providerAccountId` / email checks, the `try/catch` returning `false`, the
>   final `return true`, the id/role stash); nothing was deleted —
>   `lib/users.findOrCreateGoogleUser` stays as the Mongo impl the adapter wraps,
>   and `getCachedSession` stays flat (hot path, imported by many still-flat route
>   handlers). The **auth surface is now essentially closed** (validator, issuer,
>   magic-link, Google sign-in all migrated); only `getCachedSession` plus the big
>   subsystems (chat/`LlmGateway`, embroidery, worker) remain flat.
>   **Also:** the AI content tools — `search_projects`, `search_blog`,
>   `get_resume` — moved their ranking/scoring/section logic and result DTOs into
>   `SearchProjects` / `SearchBlog` / `GetResumeSection` use-cases
>   (`application/use-cases/ai/`), each *composing* the existing content read it
>   needs (`GetAllProjects` / `GetAllPosts` / `GetResume`) so the AI ranks the
>   same ordered list the pages render; the ranking is a pure exported function
>   (`rankProjects` / `rankPosts` / `selectResumeSection`) unit-tested without
>   I/O. The OpenAI tool *descriptors* and the `registry.ts` dispatcher stay flat
>   (LLM-coupled config, for the later chat + `LlmGateway` slice); `execute*()`
>   shrank to thin container delegates with unchanged signatures. **Also:** the
>   `Cache` port — a driven-port inversion (no user action, no use-case) that
>   puts `Cache` → `MemTtlCache` (a thin delegate over the `lib/cache`
>   `globalThis` store) in front of the in-process TTL cache and injects it into
>   the two already-migrated adapters that still imported `lib/cache` directly
>   (`ApiKeyVerifierAdapter`, `InProcessMagicLinkTokens`). The port is
>   **synchronous** so the magic-link single-use read-then-delete stays atomic;
>   `MemTtlCache` never allocates its own store, so the still-flat consumers
>   (`getCachedSession`, the two embroidery in-flight locks) and the issuer's
>   module-level `evictCachedApiKey` keep hitting the one shared store —
>   `src/lib/cache.ts` stays as that store, just minus its two infra importers.
>   **Also:** the **worker subsystem's first sub-slice** — the weekly IndexNow
>   sweep. The cron scheduler (`src/worker/index.ts`) is now a thin **driving
>   adapter** over the `PingIndexNow` use-case
>   (`application/use-cases/indexnow/ping-indexnow.ts`), which holds the exact
>   orchestration (static-route + projects + posts content list, the `Promise.all`
>   upsert, the nothing-due early return, the **stamp-only-on-success** rule, every
>   log line) behind two driven ports: `IndexNowLog` → `MongoIndexNowLog` (wraps
>   the unchanged `lib/indexnow-tracker`, including the due-logic Mongo query) and
>   `IndexNowSubmitter` → `HttpIndexNowSubmitter` (wraps the unchanged
>   `lib/indexnow.submitToIndexNow`). Config (`staticRoutes` / `projectBaselineDate`
>   / `baseUrl`) is injected for testability; it wires through the DB-backed
>   `container.ts` (the worker has Mongo and every caller is the scheduler).
>   `runIndexNowPing` shrank to a one-line `createContainer().pingIndexNow.execute()`
>   wrapper so the schedule (`30 4 * * 3`), timezone, `try/catch`, and
>   `shuttingDown` guard in `index.ts` are unchanged; **`lib/indexnow-tracker` and
>   `lib/indexnow` stay (wrapped, not deleted)**. This is the model for the later
>   `RefreshSupplyFeeds` job. **Also:** the **`ObjectStore` (R2) port** — another
>   driven-port inversion (no user action, no use-case). The S3 implementation
>   moved verbatim out of `src/lib/r2.ts` into `R2ObjectStore`
>   (`infrastructure/object-store/r2-object-store.ts`), now the **sole `@aws-sdk`
>   importer**: the `dev_` `applyEnvPrefix` choke point, the public-URL slash
>   handling, the presigned-URL TTL/filename (`Content-Disposition`,
>   double-quote-stripped) + `expiresAt` math, and the NoSuchKey/404 → `null`
>   download are byte-for-byte preserved. Because `lib/r2` is imported by five
>   widely-spread modules and had no Mongo coupling, the port is wired in a
>   **DB-free `composition/object-store.ts`** (`getObjectStore()` singleton) — the
>   same no-Mongo-at-import reasoning as `content.ts`, *not* the Mongo-backed
>   `container.ts`. `src/lib/r2.ts` became a thin shim (the four functions
>   one-line-delegate to `getObjectStore()`, signatures unchanged), so all five
>   consumers stayed unchanged; the pure logic (`applyEnvPrefix` / `buildPublicUrl`
>   / `contentDispositionFor`) is unit-tested without S3. **Also:** the
>   **`SupplyFeedSource` port** — the driven-port layer of the supply-feed worker
>   (the orchestrator stays flat for the next slice). The 7 active vendor pulls
>   sit behind `SupplyFeedSource` (`{ readonly name; pull(): Promise<unknown> }`,
>   shaped to what the orchestrator's loop + `onlyVendor` filter consume): one
>   adapter per vendor in `infrastructure/supply-feed/`
>   (`Gunnold`/`Sulky`/`Allstitch`/`Habanddash`/`Coldesi`/`Threadart`/`Ohmycrafty`
>   `FeedSource`), each **wrapping the unchanged `jobs/sources/<vendor>-pull`
>   parser** (parsing untouched; the `*-pull.ts` files stay put — relocation
>   deferred). Wired DB-free in **`composition/supply-feed.ts`**
>   (`getSupplyFeedSources()`, same vendor order as the old inline `VENDORS`
>   literal — the order is behavior-bearing for the `Promise.allSettled` outcome
>   mapping), mirroring `object-store.ts` / `content.ts`. madeirausa stays
>   excluded (not-yet-implemented stub) and Hab+Dash runs anonymous-without-creds,
>   both preserved exactly. `runRefreshEmbroiderySupplies` only swapped its 8
>   `pull*` imports + 7-entry inline literal for `const VENDORS =
>   getSupplyFeedSources()`; everything else (the mutual-exclusion flag,
>   `archiveVendor`, `loadCompileInputFromR2`, `compileFeeds`, snapshots,
>   `skipPulls`/`onlyVendor`, the throw-if-all-failed rule, every log line) is
>   byte-for-byte unchanged. **Also:** the **`RefreshSupplyFeeds` orchestrator** —
>   the last big piece of the supply-feed worker. The ~260-LOC
>   `runRefreshEmbroiderySupplies` lifted verbatim into the `RefreshSupplyFeeds`
>   use-case (`application/use-cases/supply-feed/refresh-supply-feeds.ts`): the
>   mutual-exclusion flag (now closure-captured on a composition **singleton**, so
>   still process-wide), the two archive keys per vendor (`current.json` +
>   `archive/<YYYY-MM-DD>.json`), the three derived feeds
>   (`products/current.json`, `listings/current.json`, `listings/current.csv` —
>   the **code**, not the file's stale "details/pricing" comment), the
>   `Promise.allSettled` + positional failure mapping + throw-only-when-all-failed
>   rule, the `skipPulls`/`onlyVendor` branches (incl. the no-match early
>   `{ status: "ok" }` return), and **every log line** are byte-for-byte preserved.
>   It reuses `SupplyFeedSource` + `ObjectStore` and adds two consumer-defined
>   seams whose behavior lives in the adapter: `LocalSnapshotSink` →
>   `DiskLocalSnapshotSink` (the dev-`NODE_ENV` gating + `mkdir`/write stay in the
>   adapter, so the use-case is env-agnostic) and `FeedCacheInvalidator` →
>   `FeedReaderCacheInvalidator` (wraps the unchanged `invalidateFeedCache`).
>   `compileFeeds` and `VENDOR_NAMES` are **injected** (so the use-case test fakes
>   them and `compile-feeds.ts` — palette `readFileSync` and all — stays
>   untouched; the route still imports `VENDOR_NAMES` from there). Wired DB-free in
>   `composition/supply-feed.ts` (`getRefreshSupplyFeeds()`); the worker job shrank
>   to a thin wrapper, so **both callers are byte-for-byte unchanged** — the cron
>   in `src/worker/index.ts` and the manual-refresh route. **The supply-feed worker
>   subsystem is now fully on the hexagon**, except the deferred verbatim
>   relocation of the 7 `*-pull.ts` parsers into `infrastructure/supply-feed/`.
>   **Also:** the **`EmbroideryComputeGateway` port** — the first embroidery-pipeline
>   sub-slice (a driven-port inversion of the Python embroidery-compute
>   microservice's HTTP client; no user action, no use-case). The `node:http`
>   machinery moved verbatim out of `src/app/embroidery/_lib/worker.ts` into
>   `HttpEmbroideryWorker` (`infrastructure/embroidery/http-embroidery-worker.ts`),
>   now the **sole module that knows `WORKER_URL` / speaks `node:http` to the Python
>   service**: the 15-min socket timeout (load-bearing — Ink/Stitch runs ~5–10 min,
>   past undici fetch's 5-min headers cap, so it stays `node:http` **not** `fetch`),
>   the protocol/port selection, the header names, the `<200 || >=300` rejection +
>   500-char error-body slice, and the `timed out after Nms` message are byte-for-byte
>   preserved. `WorkerError` is defined **once** in the port and re-exported through
>   both the adapter and the shim (never redefined), so the two generate routes'
>   `instanceof WorkerError && err.status === 503` keeps working; the contract types
>   (`ClusterRouting`/`SampledColor`/`SampledColors`) live in the port too and are
>   re-exported, so `ai/select-palette.ts`'s `SampledColors` type import is unchanged.
>   The trace + sample-colors querystring construction was extracted into pure
>   exported `buildTraceQuery`/`buildSampleColorsQuery` (mirroring R2's
>   `buildPublicUrl`) and unit-tested (palette `#`-strip + join, `extract_outline`
>   `1`/`0`, the routing clusters===routes guard, skip indices, `n`/`full_res`/`size`);
>   the `node:http` send itself is a thin pass-through, not unit-testable without a
>   live server (no real-network test). Because `_lib/worker.ts` had **zero** Mongo
>   coupling and is reached by `pipeline.ts` + both generate routes + `select-palette`,
>   the port is wired in a **DB-free `composition/embroidery-compute.ts`**
>   (`getEmbroideryComputeGateway()` singleton) — same no-Mongo-at-import reasoning as
>   `object-store.ts`/`content.ts`. `_lib/worker.ts` became a thin shim (the 3 fns
>   one-line-delegate, signatures + defaults unchanged), so `pipeline.ts`, both
>   routes, and `select-palette.ts` are byte-for-byte unchanged. A
>   `FakeEmbroideryComputeGateway` is staged for the later `RunEmbroideryPipeline`
>   use-case test.
>   **Also:** the **embroidery quota rule** — a pure-domain extraction (no port,
>   no use-case, like `parseBlogPost`/`sortProjects`). `computeQuota` did **zero
>   I/O** (the caller passes in the already-read `Generation[]`), so the whole
>   module (`computeQuota` + the `Quota` interface + `MONTHLY_LIMIT` /
>   `WINDOW_DAYS` / `WINDOW_MS`) moved **verbatim** from
>   `src/app/embroidery/_lib/quota.ts` into `domain/embroidery/quota.ts` and was
>   unit-tested — the 20-per-rolling-30-days policy, byte-for-byte: the
>   strict-less-than window (a generation exactly `WINDOW_MS` old is **not**
>   in-window), the `>= MONTHLY_LIMIT` threshold, the `unlimited` short-circuit,
>   and the oldest-in-window `nextResetAt`. All four importers (`/api/embroidery/
>   generate`, `/embroidery/api/generate-from-url`, the `/embroidery` page, the
>   client `ImageUploader.tsx`) repointed **directly** to
>   `@/domain/embroidery/quota` — no shim, since there's no I/O or DI to invert —
>   and `_lib/quota.ts` was **deleted**. The route-level quota *orchestration*
>   (reading `user.generations`, the `unlimited` allow-list, the 429) stays flat
>   in the generate routes; it migrates later with `RunEmbroideryPipeline`.
>   `_lib/auth.ts` is already a thin `requireAuth` wrapper (slice 8) and needed no
>   change.
>   **Also:** the **embroidery geometry libs** — a second pure-domain relocation
>   (same shape as the quota slice). The **8 pure geometry files** (`path-parser`,
>   `enclosure`, `prefilter`, `metrics`, `analyze-svg`, the `index.ts` barrel,
>   `types`, `strip-paths` — pure SVG path math / string parsing, **zero I/O**)
>   moved **verbatim** as a cohesive subfolder from `src/app/embroidery/_lib/geometry/`
>   into `domain/embroidery/geometry/` (intra-lib relative imports unchanged), and
>   the highest-value ones (path-parser, metrics, enclosure) are unit-tested. The
>   geometry barrel's two importers — `_lib/inkstitch/apply-attrs.ts` (a
>   `PathRecord` *type* import) and the un-migrated `_lib/ai/tag-svg.ts` (import
>   path **only**, no logic) — repointed to `@/domain/embroidery/geometry`, and
>   `_lib/geometry/*` was **deleted** (no shim). The `inkstitch/` trio
>   (`apply-attrs` + `thread-palette` + `gpl-palette`) is **deferred**:
>   `gpl-palette.ts` `readFileSync`s the bundled `.gpl` catalog via
>   `new URL("./palettes/<file>.gpl", import.meta.url)` (file-location-relative,
>   Turbopack-static-emitted), so it can only move together with its 75-file
>   `palettes/` sibling dir + a repoint of the dev scripts/`API.md` that hardcode
>   the old palette path — its own slice. The four palette routes, `pipeline.ts`,
>   and `ai/select-palette.ts` are untouched; the `.gpl` files load identically.
>   **Also:** the **`LlmGateway` port + the embroidery AI** — the long-deferred
>   keystone that finally puts the OpenAI client behind a port. The two embroidery
>   AI calls are uniform (a `json_object` chat completion, `gpt-5.4-mini`, a system
>   message + a (text + `image_url` detail `"high"`) user message, no tools/no
>   streaming, both reading `choices[0]?.message?.content ?? ""` then
>   `JSON.parse`), differing only in temperature (`select-palette` 0, `tag-svg`
>   0.2) and prompt — so the port (`application/ports/llm-gateway.ts`) has **one**
>   domain-shaped method, `generateJsonFromImage({ model, temperature,
>   systemPrompt, userText, imageUrl }) → Promise<string>`, with **no OpenAI types
>   leaked** (the `json_object` response_format + image detail `"high"` are its
>   contract). `OpenAiChatGateway` (`infrastructure/llm/openai-chat-gateway.ts`)
>   builds the exact `create()` call both consumers issued — it's the **sole
>   `openai`-SDK touch on the embroidery-AI path** — and reuses `getOpenAI()` from
>   `@/lib/ai/client`. Wired DB-free in **`composition/llm.ts`**
>   (`getLlmGateway()` singleton, mirroring `object-store.ts` /
>   `embroidery-compute.ts` — the LLM needs no Mongo). `select-palette.ts`
>   (`selectPalette`) and `tag-svg.ts` (`askOpenAI`) **stay flat functions**, just
>   sourcing the LLM through the port (the incremental repoint pattern); they drop
>   their `getOpenAI` imports but keep **all** parsing/consolidation/validation
>   byte-for-byte. The payoff: the Lab-merge / cap / routing consolidation is now
>   **unit-tested** against a `FakeLlmGateway` (10 tests) — plus `tag-svg`'s
>   request shape + canned-`paths` mapping (2 tests) — with **no network**. Model,
>   temperatures, message structure, user-text strings, and the content extraction
>   are preserved exactly. (At this point `src/lib/ai/client.ts` still backed both
>   the adapter and the still-flat chat loop; the chat-loop slice below finished
>   the isolation and deleted it.)
>   **Also:** the **`RunEmbroideryPipeline` use-case** — the embroidery-pipeline
>   keystone. The ~389-LOC `runPipeline` orchestrator lifted **verbatim** into
>   `application/use-cases/embroidery/run-embroidery-pipeline.ts` behind its ports:
>   the Python compute (`EmbroideryComputeGateway`), R2 (`ObjectStore`), the
>   `LlmGateway`-backed AI (`selectPalette`/`tagSvg`, injected as functions), the
>   bundled-`.gpl` palette load (`loadPalette`/`filterAvailable`, **injected** —
>   `gpl-palette` stays flat, the deferred build-fragile piece), and a **new
>   `LocalArtifactSink`** → `DiskLocalArtifactSink`
>   (`infrastructure/embroidery/`; owns `node:fs` + the
>   `process.cwd()/tmp/embroidery` path verbatim, mirroring `DiskLocalSnapshotSink`)
>   for the local-disk mirror + ZIP extraction. The stage sequence, every
>   `step()`/`plog()`/`perr()` log line, the background-role skip indices, the
>   best-effort `sampleColors` `.catch`, the artifact names + content types + R2
>   keys (`embroidery/<customerId>/<hash>_<size>/…`), the `embroidery.bmp` publish,
>   and the `PipelineResult` are byte-for-byte preserved — **and `SKIP_AI_PALETTE =
>   true` is kept verbatim** (the AI palette stays skipped exactly as in the
>   current tree). The pure value-objects (`validateSize`/`validateCustomerId` +
>   the constants + errors) and the pure `extractZip`/`hashPng` moved to
>   `domain/embroidery/pipeline-validation.ts`. `_lib/pipeline.ts` shrank to a thin
>   `runPipeline` wrapper that one-lines `getRunEmbroideryPipeline().execute(...)`
>   and **re-exports** those validators/constants/types, so all three generate
>   routes (+ the `convert`/`sizes` routes) are byte-for-byte unchanged. Wired
>   **DB-free** in `composition/embroidery-pipeline.ts` (the pipeline touches no
>   Mongo — generation persistence stays flat in the routes via `lib/users`), so it
>   doesn't drag `mongodb.ts`'s connect-at-import into the routes. 9 new tests run
>   the whole pipeline against the staged fakes (`FakeEmbroideryComputeGateway` +
>   fake `ObjectStore` + fake `LocalArtifactSink` + fake AI/palette fns, with a real
>   STORED-method ZIP so `extractZip` runs) — no Docker, no R2, no OpenAI, no real
>   disk. **Still flat in the embroidery surface:** the inkstitch trio (`gpl-palette`
>   deferred for the `.gpl` load), the route-level quota/auth orchestration, and
>   generation persistence.
>   **Also (FINAL subsystem):** the **chat loop + conversations behind
>   `LlmGateway`** — the portfolio-assistant tool loop, the last subsystem to
>   migrate, and the slice that **fully isolates the OpenAI SDK**. `LlmGateway`
>   gained a second, tool-loop method — `createChatCompletion({ model, temperature,
>   maxCompletionTokens, messages, tools?, responseFormatJson? }) → { hasChoice,
>   content, toolCalls, finishReason }` — with **domain-shaped DTOs** (a
>   `ChatMessage` union, `ToolCall`, and a `ToolSchema` structurally matching
>   `registry.ts`'s `toolSchemas` so they pass through unchanged), so no OpenAI
>   types cross the boundary; the adapter does the bidirectional message ↔
>   tool_call mapping (the round-trip is the crux). `runAssistantTurn` /
>   `summarizeAndSetTitle` became `RunAssistantTurn` / `SummarizeConversationTitle`
>   (`application/use-cases/chat/`), lifted verbatim — same model (`gpt-5.4-mini`),
>   temps (0.7 loop / 0.3 title), `max_completion_tokens` (1500 / 60), the 50-msg
>   window, BASE_SYSTEM_PROMPT (incl. the tolerance interpolation), the ≤4-iteration
>   cap + fallback, the `finish_reason === "tool_calls"` round-trip, and the title
>   parse + clamp(60). The two Mongo writes the loop/titler do (`appendMessage` /
>   `setTitle`) went behind a new **`ConversationStore`** port →
>   `MongoConversationStore` (wraps the unchanged `lib/ai/conversations` writes);
>   the **read** side of `conversations.ts` stays flat in the chat routes.
>   `ConversationMessage`/`ToolResultPayload` moved to
>   `domain/chat/conversation-message.ts` and are re-exported from `conversations.ts`
>   so the routes are unchanged; `resolvePageContext` lifted verbatim to
>   `composition/chat-page-context.ts` (injected); `dispatchTool`/`toolSchemas`
>   injected from the unchanged `registry.ts`. Wired in the DB-backed `container.ts`
>   (reusing the DB-free `getLlmGateway()` singleton); `chat.ts` shrank to two
>   thin wrappers that adapt the route's `ObjectId` id → string and delegate, so
>   **`POST /api/chat` is byte-for-byte unchanged**. **`src/lib/ai/client.ts` is
>   deleted** — `chat.ts` was its last `getOpenAI` consumer, the client
>   construction moved into `OpenAiChatGateway`, and the adapter is now the **sole
>   `import OpenAI from "openai"` in the app** (full SDK isolation). 12 new tests
>   against the extended `FakeLlmGateway` + a fake `ConversationStore` — the
>   tool-loop dispatch/append/loop, the iteration cap → fallback, immediate no-tool
>   return, the thrown-tool error message (not added to `toolResults`), the
>   unsupported-type branch, no-choice → fallback, and the titler's parse + clamp +
>   fallbacks — no network.
>   `src/lib/email.ts`,
>   `magic-link.ts`, `resume.ts`, `projects.ts`, `blog.ts`, `testimonials.ts`,
>   `marquee.ts`, and `ai/client.ts` are gone. Note: content reads
>   wire through a separate `composition/content.ts` (no DB import — `mongodb.ts`
>   connects at import). See [`migration.md`](docs/architecture/migration.md) →
>   *Progress* for the running log and locked-in conventions.
> - **Un-migrated code** is still flat (`src/lib/*` getters/services). It works;
>   leave it working.
>
> **Rules of engagement:** every slice is **behavior-preserving** (same routes,
> endpoints, output) and lands **green** (typecheck + `npm test`). When you
> migrate a slice, take it end-to-end — domain → port → adapter → use-case →
> rewired driving adapter — and **delete the flat code only once its last
> consumer is gone** (a shared `src/lib/*` helper stays until every workflow that
> imports it has moved). Don't do drive-by partial moves as a side effect of an
> unrelated task, and don't describe un-migrated code as if it were hexagonal.

**Why the target exists — four goals:** testability, component/layer separation,
separation by actor, and dependency inversion. The model is the means; those
properties are the end.

**The model (target):** the server is a hexagon — Ports & Adapters. Dependencies
point inward.

| Layer | Holds | May depend on |
| --- | --- | --- |
| `domain/` | Entities, value objects, pure rules. **Zero I/O.** | nothing |
| `application/` | Use-cases + `application/ports/` (interfaces) | `domain` |
| `infrastructure/` | Adapters (Mongo, R2, OpenAI, Brevo, the Python worker, vendor feeds) | `application/ports` (inward) |
| `composition/` | DI wiring | everything — only place that imports concrete adapters |
| `app/` | Next.js routing only — thin driving adapters | `application`, `composition` |

Driving adapters (Server Components, Route Handlers, Server Actions, the cron
scheduler) stay thin: parse → use-case → render. The client is **feature slices**
(`features/<feature>/`) plus shared `components/ui/` primitives, not the server
hexagon; the client tree never imports the server rings.

**The full spec lives in [`docs/architecture/`](docs/architecture/overview.md):**

- [overview](docs/architecture/overview.md) — the model, the four goals, layer/dependency rules, ports, naming.
- [data-and-content](docs/architecture/data-and-content.md) — JSON/Markdown content vs Mongo app data; the `ContentSource` boundary.
- [auth](docs/architecture/auth.md) — NextAuth + magic-link + per-surface API keys; the three-actor model.
- [external-services](docs/architecture/external-services.md) — Mongo, R2, OpenAI, Brevo, cache as driven adapters.
- [worker](docs/architecture/worker.md) — the in-process cron worker and the Python microservice; deployment.
- [embroidery](docs/architecture/embroidery.md) — the embroidery pipeline as a vertical slice.
- [migration](docs/architecture/migration.md) — current flat layout → target map, the vertical-slice strategy, and the running progress log.

## Conventions

Headlines; the reasoning lives in `docs/architecture/`. These are the **target**
and the standard every migrated slice (and all new code) must meet; un-migrated
flat code hasn't been brought up to them yet — migrate it deliberately, slice by
slice, not as a drive-by.

- **Separate by actor.** Driving actors (browser user, API client, cron) each get
  a thin adapter over a shared use-case; driven actors (Mongo, R2, OpenAI, Brevo,
  the Python worker) each get an adapter behind a port. The defining product trait
  — every tool is **both a UI and an HTTP API** — is exactly this pattern.
- **Dependency inversion.** Use-cases depend on ports they own, never on
  `mongodb`/`openai`/`@aws-sdk`/`next-auth` directly. Those are details plugged in
  at the edge.
- **Use-case I/O:** plain DTOs in and out, never domain entities across the
  boundary. Two-tier validation — structural at the driving adapter, business
  invariants in the domain via value-object construction.
- **Errors:** `Result<T, E>` for expected failures, `throw` for exceptional
  faults; log once at the boundary with secret redaction. (Today's closest
  pattern: the embroidery pipeline's `step()`/`perr()`.)
- **Content is file-sourced.** Projects/blog/testimonials/marquee/resume/changelog
  are JSON/Markdown read through a `ContentSource`; editing is a content commit.
  `src/data/` is dev scratch, **not** content (see memory note).
- **Styling:** Tailwind v4, brand/accent/text/surface tokens via CSS vars in
  `src/app/globals.css` (brand teal `#54d9d3`, amber accent; Fraunces / Inter /
  JetBrains Mono). shadcn-style Radix + CVA primitives in `src/components/ui/`.
  Never hardcode colors — use the tokens.
- **AI is OpenAI.** The chat and the embroidery palette AI both use the `openai`
  SDK. Public copy that says "Anthropic API" is a known discrepancy to reconcile
  (see [external-services](docs/architecture/external-services.md)) — don't
  propagate it.

---

## Sitemap dates

Static-page `lastModified` timestamps live in `src/lib/sitemap-dates.ts`. Whenever a static page under `src/app/` is edited (e.g. `/about`, `/projects`, `/blog`, `/resume`, `/contact`, `/privacy`, or the root `/`), update that page's entry in `STATIC_ROUTE_DATES` to the current date/time.

## Project/work sync

Projects live in `src/content/projects/*.json` (one file per project). Both the home page (`src/app/page.tsx`, via `getFeaturedProjects()`) and the work page (`src/app/projects/page.tsx`, via `getAllProjects()`) render from the same source, so edits to a JSON flow to both automatically. But the home page is a **hard cap of 4** — the four most important works — and is controlled by the `featured: true` flag plus the `order` field. When changing work:

- **Adding a new project:** create its JSON. If it belongs in the top 4, set `featured: true` and give it an `order` that slots it correctly. If there are already 4 featured projects and the new one is more important, demote a current featured project (`featured: false`) at the same time — never leave 5 featured.
- **Removing/retiring a project:** delete the JSON. If it was featured, promote the next-most-important project (`featured: true`) so the home page still shows 4.
- **Reordering the top 4:** adjust the `order` field on the featured entries. Lower `order` renders first.
- **Editing a project's copy, stack, or URLs:** the JSON is the single source — no per-page duplication, but verify both pages still look right.
- Don't forget the README sync rule below — the README lists the same featured 4 and needs the matching update.

## README sync

`README.md` doubles as the GitHub profile README for `jawetzel/Jawetzel` — it mirrors content sourced from the site. Whenever any of the following change, check whether `README.md` needs the matching update:

- `src/content/projects/*.json` — project names, taglines, URLs, stacks, or featured list
- `src/app/about/page.tsx` — day-job narrative, employer names, location, years-of-experience
- `src/app/page.tsx` — top-level tagline or the availability signal ("Taking on one new engagement this quarter")
- `src/app/security-audit/page.tsx` — if the case study is un-redacted or the link moves
- A new featured project is added, or an existing one is removed/retired

Keep the README's voice and structure consistent with the portfolio — same taglines, same em-dashes, no badge clutter.

## "Write it up" — changelog + draft commit message

The user commits manually. **Never run `git commit`, `git add`, or any other git write command** as part of this workflow. Read-only git commands (`status`, `diff`, `log`, `ls-files`) are fine and expected.

When the user says **"write it up"**:

1. **Read the full git diff first** — `git status` and `git diff HEAD` (plus untracked files via `git ls-files --others --exclude-standard`). The working tree may include changes from prior Claude sessions or work the user did outside chat — the changelog and the drafted commit message need to cover **everything in the diff**, not just what was discussed in the current conversation. If something in the diff doesn't have obvious context, ask before writing it up.
2. **Append a changelog entry** to `src/content/changelog.json`. The file is an array of `{ date, title, description }`:
   - `date` — ISO date (`YYYY-MM-DD`) the change shipped
   - `title` — short, human-readable headline (≤ 70 chars)
   - `description` — one or two sentences on what changed and why it matters to a visitor; if the diff spans multiple unrelated changes, group them or write multiple entries
   - Newest entries go at the **top** of the array
   - Voice: same as the rest of the site — no marketing fluff, lead with user-facing impact, em-dashes are fine
3. **Draft a commit message and print it inline** in the reply for the user to copy:
   - Subject ≤ 72 chars, imperative mood ("fix mobile severity table", not "fixed" or "fixes")
   - Body describing what changed and why, wrapped at ~72 chars; mention the distinct buckets if the diff is mixed
   - Format as a fenced code block so it's easy to copy

This file will back a public changelog/feed page later, so entries should read well in isolation.

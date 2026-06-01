# External services — the driven adapters

> Target framing. Behavior is unchanged — see [`overview.md`](overview.md) for
> status. Every external dependency below is a **driven actor**: the app calls
> *out* to it. Each already lives in its own `src/lib/` module with a narrow
> function surface — they are adapters in all but name. The refactor's job is to
> put a port in front of each so use-cases depend on the capability, not the
> vendor (**dependency inversion**), and can run against fakes (**testability**).

`next.config.ts` marks the heaviest of these external to the bundle:
`serverExternalPackages: ["sharp", "mongodb", "openai"]`. Output is
`standalone`. Security headers (HSTS, nosniff, Referrer-Policy,
Permissions-Policy, COOP) are applied to all routes there.

## MongoDB — `src/lib/mongodb.ts` → `Mongo*Repository`

- A **process-singleton `MongoClient`** that owns the driver connection pool
  (`maxPoolSize: 50`). In dev the connect promise is stashed on `globalThis` so
  HMR doesn't exhaust the pool across reloads — the prod path just connects once.
- `getDb()` returns the `Db` (name from `DATABASE_NAME`, default
  `portfoliowebsite`). `DATABASE_URL` is required at import.
- Collections (inferred from usage): `users` (see [`auth.md`](auth.md) and
  `types/user.ts`), plus chat conversations (`ai/conversations.ts`). Embroidery
  generations are embedded on the user doc (`generations[]`, `api_generations[]`,
  `demo_images[]`), not a separate collection.
- **Target:** the singleton client is already correct (stateless, injectable).
  The refactor adds `*Repository` ports and `Mongo*Repository` adapters; the
  client is injected into them, never imported by a use-case. No transactions —
  this app has no multi-document atomic requirement (contrast psychable).

## Cloudflare R2 — `src/lib/r2.ts` → `ObjectStore`

S3-compatible blob storage via the AWS SDK v3 against the R2 endpoint
(`region: "auto"`). Surface: `uploadToR2`, `downloadFromR2` (returns `null` on
`NoSuchKey`/404), `generatePresignedDownloadUrl` (default 15 min, max 7 days —
the SigV4 ceiling; optional `Content-Disposition` filename), `publicUrlFor`.

- **Two decisions worth preserving:**
  - **`applyEnvPrefix()`** — in development **every** key is silently prefixed
    `dev_`, so dev iteration never touches prod objects. A single choke point;
    callers pass logical keys and stay env-agnostic. Any new R2 helper must route
    through it.
  - **Private bucket + presigned GETs** — the bucket stays private; time-limited
    signed URLs are how clients fetch (downloads, the embroidery previews).
- Env: `CLOUDFLARE_ACCESS_KEY_ID`, `CLOUDFLARE_SECRET_ACCESS_KEY`,
  `CLOUDFLARE_ENDPOINT`, `CLOUDFLARE_BUCKET_NAME`, `CLOUDFLARE_PUBLIC_URL`.
- **Used by:** the embroidery pipeline (input + artifacts under
  `embroidery/<customerId>/<hash>_<size>/`) and the supply feeds (`supplies/…`).
- **Target:** `R2ObjectStore implements ObjectStore`. The `dev_` prefix and
  presigning are adapter details. A use-case says "store these bytes / give me a
  download URL," not "talk to R2."
- **Status: done (driven-port inversion).** `ObjectStore` →
  `R2ObjectStore` (`infrastructure/object-store/`) is the sole `@aws-sdk`
  importer; `src/lib/r2.ts` is now a thin shim delegating to a singleton wired in
  the DB-free `composition/object-store.ts` (the same no-Mongo-at-import reasoning
  as `content.ts`), so the five still-flat consumers (embroidery pipeline, upload
  route, supply-feed worker + reader, download-links route) are unchanged. See
  [`migration.md`](migration.md) → Progress.

## OpenAI — `src/lib/ai/client.ts` → `LlmGateway`

- The `OpenAI` client (`OPENAI_API_KEY`) is the only LLM SDK in the app — it
  powers both the resume-aware chat tool loop and the embroidery palette AI
  (`_lib/ai/select-palette.ts`, `tag-svg.ts`).

- **Status: done — the OpenAI SDK is fully isolated.** Both paths go through the
  `LlmGateway` port (`application/ports/llm-gateway.ts`) → `OpenAiChatGateway`
  (`infrastructure/llm/openai-chat-gateway.ts`), wired DB-free in
  `composition/llm.ts` (`getLlmGateway()`). `OpenAiChatGateway` is now the **sole
  module that imports `openai`** — `src/lib/ai/client.ts` (the old `getOpenAI`
  helper) was deleted once `ai/chat.ts` migrated, and the per-request client
  construction lives in the adapter. The port exposes **two** domain-shaped
  methods, no OpenAI types leaking across either:
  - `generateJsonFromImage({ model, temperature, systemPrompt, userText,
    imageUrl }) → Promise<string>` — the uniform embroidery-AI call (a
    JSON-object completion with a system message + a text + high-detail-image
    user message; `select-palette` uses temperature 0, `tag-svg` 0.2). The
    `json_object` response_format and image detail `"high"` are part of its
    contract.
  - `createChatCompletion({ model, temperature, maxCompletionTokens, messages,
    tools?, responseFormatJson? }) → { hasChoice, content, toolCalls,
    finishReason }` — the chat tool loop's heterogeneous call. `messages` is a
    domain `ChatMessage` union, `tools` a `ToolSchema[]` structurally matching
    `registry.ts`'s `toolSchemas` (passed through unchanged), and the adapter
    does the bidirectional message ↔ tool_call mapping. The title summarizer
    reuses it with `responseFormatJson: true` and no tools.

  See [`migration.md`](migration.md) → Progress (the chat-loop slice).

> **⚠ Discrepancy to reconcile.** The public stack lists (the project case study
> JSON, `README.md`) market the AI as **"Anthropic API."** The code uses
> **OpenAI** end to end — there is no `@anthropic-ai/sdk` dependency. Either the
> copy is aspirational/outdated or a provider swap was intended and not done.
> Flagged here, not silently "fixed": resolve the copy or the code deliberately,
> don't let the docs paper over it. (A provider swap is exactly what the
> `LlmGateway` port makes a one-adapter change.)

### The chat tool loop

The assistant runs in the `RunAssistantTurn` use-case
(`application/use-cases/chat/`): system prompt + conversation history →
`LlmGateway.createChatCompletion` with a tool catalogue, **max 4 tool
iterations**, results rendered for the UI and the final assistant turn persisted
to Mongo behind the `ConversationStore` port (→ `MongoConversationStore`, which
wraps `ai/conversations.ts`). `SummarizeConversationTitle` titles the thread on
the first exchange. `POST /api/chat` reaches both through the thin
`runAssistantTurn` / `summarizeAndSetTitle` wrappers in `ai/chat.ts`; the read
side of `ai/conversations.ts` (create / fetch / list / claim / delete) stays
flat in the chat routes. The tools live in `src/lib/ai/tools/` behind
`registry.ts`:

| Tool | Reads |
| --- | --- |
| `search_projects` | `projects.ts` (case studies) |
| `search_blog` | `blog.ts` |
| `get_resume` | `resume.json` |
| `find_thread_color` | the compiled supply feed (`ai/embroidery-supplies/feeds.ts`) |

`dispatchTool(name, rawArgs)` parses args and routes by name, throwing on
unknown tool / bad JSON so the model can recover.

- **Target — the load-bearing rule:** tools must invoke **application
  use-cases** through ports, never do I/O inline. `search_projects` calls the
  same `SearchProjects` use-case the `/projects` page would; `find_thread_color`
  calls the same feed-search use-case the supply tool's API uses. That keeps the
  AI surface honest (it can't reach data the rest of the app can't) and makes the
  whole chat loop testable against a `FakeLlmGateway` + fake content ports.

## Brevo — `src/lib/email.ts`, `src/lib/sms.ts` → `EmailSender` / `SmsSender`

Both are thin REST clients against `https://api.brevo.com/v3` (`BREVO_API_KEY`).
`sendEmail` posts to `/smtp/email` (default sender Joshua Wetzel /
`EMAIL_FROM`); `sendSms` sends transactional SMS (E.164 recipient,
`BREVO_SMS_SENDER`). Inbound SMS arrives at `POST /api/sms` (Brevo webhook).

- **Target:** `BrevoEmailSender implements EmailSender`, `BrevoSmsSender
  implements SmsSender`. Use-cases (contact form, magic link, any future
  notification) depend on the `*Sender` capability; tests use `FakeEmailSender`
  and assert on the captured message, never hitting Brevo.

## Cache & rate limiting — `src/lib/cache.ts`, `src/lib/rate-limit.ts`

- **`cache.ts`** — an in-memory TTL map stored on `globalThis` (survives HMR),
  with **in-flight dedup**: `getCachedOrFetch(key, fetcher, ttl)` shares one
  promise across concurrent callers for the same key. Backs the session cache
  (10 min), the API-key cache (20 min), and the supply-feed cache. **Single-
  instance** — see the magic-link caveat in [`auth.md`](auth.md).
- **`rate-limit.ts`** — throttles public endpoints (e.g. the contact form).
- **Target:** `Cache` and `RateLimiter` ports with the in-memory adapters today;
  a distributed adapter (Redis) becomes a drop-in if the app ever scales past one
  replica. Deployment context (single replica, IPv6-only private network) is in
  [`worker.md`](worker.md).

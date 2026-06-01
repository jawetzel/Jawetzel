# Embroidery pipeline

> Target framing. Behavior is unchanged — see [`overview.md`](overview.md) for
> status. Embroidery is the **canonical vertical slice** in this app and the
> clearest case of the UI+API dual-driving-adapter pattern: one pipeline, driven
> by a browser form *and* a public HTTP API. It is also the most
> self-contained — it already lives almost entirely under
> `src/app/embroidery/_lib/`, a near-feature-folder.

## What it does

Turn an uploaded image into a machine-ready embroidery file: validate → sample
colors → pick a thread palette → trace to SVG → tag/clean the SVG → convert to
stitches, persisting every artifact to R2 and Mongo. The heavy computer-vision
and stitch generation runs in the **Python microservice**
([`worker.md`](worker.md)); the TypeScript here is the **orchestrator**.

## Driving adapters (the two front doors)

| Adapter | Auth | Purpose |
| --- | --- | --- |
| `/embroidery` (`page.tsx`) | session-aware (sign-in panel inline) | The browser UI — upload, history, API-key panel |
| `POST /api/embroidery/generate` | session **or** per-user `pwsk_` key | The pipeline trigger (long-running) |
| `GET /api/embroidery/palettes`, `/palettes/[manufacturer]` | `EMBROIDERY_API_KEY` surface | Available thread palettes |
| `GET /api/embroidery/sizes` | — | Allowed hoop sizes |
| `/embroidery/api-docs` | — | Scalar-rendered OpenAPI reference (`src/app/openapi/embroidery/spec.json`) |

Both front doors funnel into the same orchestration. That is the product
promise ("each tool ships as both a UI and an HTTP API") expressed as
architecture — and the reason the hexagon earns its keep here.

## `_lib/` — the orchestration today

```
src/app/embroidery/_lib/
  auth.ts        per-surface API-key binding (EMBROIDERY_API_KEY) → see auth.md
  pipeline.ts    runPipeline() — now a THIN WRAPPER over the RunEmbroideryPipeline use-case (re-exports the validators/constants)
  quota.ts       (gone — the rule moved to domain/embroidery/quota.ts)
  worker.ts      HTTP client to the Python service (trace / convert / sample)
  ai/            select-palette.ts, tag-svg.ts, prompts.ts  (OpenAI)
  geometry/      analyze-svg, enclosure, path-parser, strip-paths, metrics  (pure)
  inkstitch/     thread-palette, gpl-palette, apply-attrs + palettes/*.gpl  (90+ files)
_components/      ImageUploader, GenerationsList, ApiKeyPanel
```

### `runPipeline()` — the steps

`runPipeline(pngBytes, sizeRaw, colorsRaw?, opts)` (`pipeline.ts`) is a sequence
of instrumented `step()`s (each logs timing; `perr()` dumps the full cause
chain on failure — the app's most mature error-handling pattern):

1. **Validate / construct** — `validateSize` (`4x4 | 5x7 | 6x10 | 8x8`),
   `validateCustomerId` (path-safe, blocks `..`), clamp `colors` to `1–16`
   (default 12), resolve `manufacturer` → `loadPalette` → `filterAvailable`.
   These are **domain invariants enforced at construction** — the seed of the
   target's value-object discipline.
2. **Hash + key** — `sha256(png)[:12]`; R2 prefix
   `embroidery/<customerId>/<hash>_<size>/`. Every artifact is `persist()`-ed to
   **both R2 and a local `tmp/` dir**.
3. **`sampleColors`** (Python, best-effort — failure degrades to RGB-nearest).
4. **`selectPalette`** (OpenAI) — picks threads from the real catalog, marks an
   `extract_outline` flag and per-cluster routing; background-role threads are
   ripped out (left as fabric).
5. **`traceImage`** (Python) → `traced.svg`.
6. **`tagSvg`** (OpenAI) → `cleaned.svg` + `tagged.svg` + a geometry report;
   applies underlay for line-art.
7. **`convertSvg`** (Python) → `out.zip`; the zip is extracted locally and
   `embroidery.bmp` (the stitch preview) is published to R2.

Output: `{ key, customerId, hash, size, colors, artifacts[], urls{}, localDir }`.
The generation record (zip + preview URLs) is saved onto the **user document**
in Mongo (`generations[]` for UI runs, `api_generations[]` for API runs — see
`types/user.ts`); `quota.ts` enforces a per-user windowed cap.

> **Current debug state — do not mistake for design.** `pipeline.ts` ships with
> `SKIP_AI_PALETTE = true`, which **bypasses the `selectPalette` AI call** and
> lets the worker quantize unconstrained — a switch for isolating trace-stage
> behavior. Flip back to `false` before relying on AI palette selection. Noted
> so the docs don't describe a code path that's currently short-circuited.

> **Open algorithm gap (Python side).** Subject/background separation currently
> leans on a border-connected flood-fill that only reliably catches near-white
> paper backgrounds; real photographs need true subject isolation (likely
> `rembg`). This is a *worker algorithm* concern, not a TS-architecture one — see
> the embroidery subject-isolation memory note.

## Target

`runPipeline()` **is now** `RunEmbroideryPipeline` — an **application use-case**
taking ports, not concrete clients
(`application/use-cases/embroidery/run-embroidery-pipeline.ts`, wired DB-free in
`composition/embroidery-pipeline.ts`; `_lib/pipeline.ts` is a thin `runPipeline`
wrapper so the three generate routes are unchanged). `SKIP_AI_PALETTE = true` is
preserved verbatim inside the use-case — the AI palette stays skipped exactly as
in the current tree.

| Dependency (today) | Port (target) | Adapter |
| --- | --- | --- |
| `worker.ts` (HTTP → Python) | `EmbroideryComputeGateway` ✅ done | `HttpEmbroideryWorker` (`infrastructure/embroidery/`; the sole `node:http`/`WORKER_URL` knower, wired DB-free in `composition/embroidery-compute.ts`; `worker.ts` is now a thin shim) |
| `r2.ts` | `ObjectStore` ✅ done | `R2ObjectStore` (the use-case calls `objectStore.upload`/`publicUrl`) |
| `ai/select-palette`, `ai/tag-svg` (OpenAI) | `LlmGateway` ✅ done | `OpenAiChatGateway` (the AI fns are injected into the use-case; LLM behind the gateway) |
| local `tmp/embroidery` writes | `LocalArtifactSink` ✅ done | `DiskLocalArtifactSink` (`infrastructure/embroidery/`; owns `node:fs` + the `process.cwd()/tmp/embroidery` path verbatim, mirrors `DiskLocalSnapshotSink`) |
| generation persistence | `UserRepository` (or `GenerationRepository`) — **still flat** | Mongo (`lib/users`, in the routes) |

- **`geometry/` and `inkstitch/` are already pure** (SVG path math, GPL palette
  parsing, attribute mapping) — they move to `domain`-adjacent libs and are
  **unit-testable as-is**, no ports needed. They are the easiest testability win
  in the whole codebase. **Status:** the 8 pure `geometry/` files are now
  `domain/embroidery/geometry/*` (moved verbatim, unit-tested). The `inkstitch/`
  trio is **deferred** — `apply-attrs`/`thread-palette` are pure, but
  `gpl-palette.ts` `readFileSync`s the bundled `.gpl` catalog via
  `new URL("./palettes/<file>.gpl", import.meta.url)` (file-location-relative,
  Turbopack-static-emitted), so it can only move together with its `palettes/`
  sibling dir + a repoint of the dev scripts that hardcode the old path — its own
  slice. See [`migration.md`](migration.md) → *Progress*.
- The validators (`validateSize`, `validateCustomerId`, color clamp) are pure
  value-object constructors — invalid states are unconstructable. **Status:**
  they now live in `domain/embroidery/pipeline-validation.ts` (alongside the pure
  `extractZip` ZIP reader + `hashPng`), re-exported from `_lib/pipeline.ts` so
  the routes' imports are unchanged. (A future refinement could name them
  `HoopSize`/`CustomerId`/`ColorCount` types; today they stay the functions.)
- The use-case takes its ports, so the *entire* pipeline **now runs in a unit
  test against fakes** that return canned SVG/zip bytes, a stub LLM, a fake
  object store, and a fake local-artifact sink — no Docker, no R2, no OpenAI, no
  Mongo, no real disk. That is the testability the orchestrator couldn't reach
  before, when R2, OpenAI, and the worker HTTP client were imported directly.
  **Done** — `run-embroidery-pipeline.test.ts` exercises the stage order, the
  full persisted artifact set, the SKIP_AI_PALETTE bypass, and the validators.

## Client slice

`_components/` (`ImageUploader`, `GenerationsList`, `ApiKeyPanel`) + the page is
already a de-facto feature slice. In the target it formalizes into
`features/embroidery/` with its hooks (upload state, generation polling,
API-key issue/revoke). It must keep the **import ban**: the slice talks to
Server Actions / the `/api/embroidery/*` endpoints and the DTOs they return —
never `_lib/pipeline.ts` directly.

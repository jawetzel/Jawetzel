# Architecture overview — the target model

> **Status: target, not current.** This document and its siblings describe the
> **decided target architecture** for jawetzel.com — the shape a planned major
> refactor will move the code toward. The model is adapted from the sibling
> project **psychable** (`../psychable`), which is the reference implementation.
> **The code today is flat** (`src/app/` routes → `src/lib/*` getters/services →
> MongoDB/R2/OpenAI/Brevo, plus an in-process cron worker and a separate Python
> microservice). Migrating to this model — moving files, introducing port
> interfaces — is **out of scope** until the refactor; see
> [`migration.md`](migration.md) for the current → target map. Until then, read
> these docs as *where we're going*, and the current code as *where we are*.
>
> **This is not a rewrite and not a behavior change.** Everything works today.
> The refactor is **behavior-preserving** — same pages, same endpoints, same
> output — done purely to gain the code-quality properties below. Nothing here
> proposes changing *what* the site does.

## Why — the four goals

This model is the means; these four properties are the end. Every decision in
these docs traces back to one of them. They are also the lens for judging the
refactor: a change that doesn't advance one of these isn't worth making.

1. **Testability.** Behavior is unit-testable in isolation. Pure rules test
   directly; use-cases test against in-memory fakes injected through factories;
   adapters are integration-tested against the real dependency. If a piece of
   logic needs the network, the database, or a rendered DOM to test, the seam is
   in the wrong place.
2. **Component / layer separation.** Routing, orchestration, and pure rules live
   in distinct layers with a one-way dependency rule. UI components decompose on
   seams (re-render cadence, data dependency, reuse), not on file size.
3. **Separation by actor.** Code is grouped by *who drives it* and *what it
   drives*. Driving actors — the browser user, an API client, the cron
   scheduler — each get their own thin adapter over a shared use-case. Driven
   actors — MongoDB, R2, the LLM, Brevo, the Python worker — each get their own
   adapter behind a port. One reason to change per unit.
4. **Dependency inversion.** The application depends on **ports it owns**, never
   on concrete technology. MongoDB, OpenAI, Cloudflare, and Brevo are details
   plugged in at the edge — swappable without touching a use-case.

## What this site is

Source for [jawetzel.com](https://jawetzel.com) — a portfolio that doubles as a
host for small live tools. It is a single Next.js 16 app (App Router, React 19,
TypeScript strict, Tailwind v4) on MongoDB, with two background concerns: an
in-process `node-cron` worker and a separate Python embroidery-compute
microservice. The portfolio content (projects, blog, testimonials, resume,
marquee, changelog) is **file-sourced JSON/Markdown**, not a CMS. The tools
(embroidery image → stitches pipeline, cross-vendor supply feed, image → SVG,
resume-aware AI chat) are the dynamic, stateful surfaces.

Path alias: `@/*` → `src/*`.

## The model: a hexagon (Ports & Adapters)

The server is a hexagon — Clean / Onion / Ports & Adapters. **This governs
server-side code only.** Client/front-end architecture is a separate concern
(see **Client** below). Dependencies point **inward**.

| Layer | Holds | May depend on |
| --- | --- | --- |
| `domain/` | Entities, value objects, pure rules, domain errors. **Zero I/O.** | nothing |
| `application/` | Use-cases (orchestration) + `application/ports/` (the interfaces) | `domain` |
| `infrastructure/` | Adapters implementing ports (Mongo, R2, OpenAI, Brevo, the Python worker, vendor feeds) | `application/ports` (inward only) |
| `composition/` | Factories / DI wiring | everything — **only** place allowed to import concrete adapters |
| `app/` | Next.js routing only | `application`, `composition` |

**Dependency direction:** `app/` → `application` → `domain`. `infrastructure`
depends *inward* onto `application/ports`. Never the reverse.

**Driving adapters** = Server Components, Route Handlers, Server Actions. Keep
them thin: parse input, call a use-case, render. No business logic in `app/`.

**Driven adapters** = the things the use-cases call *out* to: MongoDB, Cloudflare
R2, the OpenAI API, Brevo, the Python embroidery worker, the vendor supply
feeds. Each sits behind a port owned by the application layer.

### Why a hexagon here

This site's defining trait is that **each tool ships as both a browser UI and an
HTTP API** (see the project case study). That is exactly the payoff of driving
adapters over shared use-cases: `/embroidery` (Server Component + form) and
`POST /api/embroidery/generate` (Route Handler) are two driving adapters over
one `RunEmbroideryPipeline` use-case. The same holds for the supply feed (UI
page + search/download endpoints) and the AI chat (UI panel + `POST /api/chat`).
The refactor formalizes a separation the product already implies.

### Ports

- **Consumer-owned.** Default location `application/ports/`. Use `domain/ports/`
  only when a pure domain service is the actual consumer.
- Name by **role/capability, not technology**. No `I` prefix.
- Role suffixes: `*Repository` (persistence), `*Source` (read-only content/feed),
  `*Sender`/`*Notifier` (messaging), `*Gateway`/`*Client` (3rd-party API),
  `*Provider` (config/clock/ids/cache).

The ports this app needs (each has exactly one production adapter today):

| Port (target) | Capability | Current adapter |
| --- | --- | --- |
| `ContentSource` | Read JSON/Markdown content (projects, blog, …) | `src/lib/projects.ts`, `src/lib/blog.ts`, … (FS reads) |
| `UserRepository` | Persist/load users | `src/lib/users.ts` (Mongo) |
| `SessionGateway` | Resolve/issue the auth session | `src/lib/auth.ts` (NextAuth) |
| `ObjectStore` | Blob storage + presigned URLs | `src/lib/r2.ts` (Cloudflare R2) |
| `EmailSender` / `SmsSender` | Transactional messaging | `src/lib/email.ts`, `src/lib/sms.ts` (Brevo) |
| `LlmGateway` | Chat + structured AI calls | `infrastructure/llm/OpenAiChatGateway` (OpenAI — done; sole `openai` importer) |
| `EmbroideryComputeGateway` | Trace / convert / sample-colors | `src/app/embroidery/_lib/worker.ts` (HTTP → Python) |
| `SupplyFeedSource` | Pull a vendor catalog | `src/worker/jobs/sources/*-pull.ts` |
| `Cache` | TTL cache with in-flight dedup | `src/lib/cache.ts` |
| `RateLimiter` | Throttle public endpoints | `src/lib/rate-limit.ts` |
| `Clock` / `IdProvider` | Time, hashes, ids | inline (`Date.now()`, `node:crypto`) today |

### Naming conventions (target)

- **Never use `services`** as a layer or folder name — it is ambiguous between
  application and infrastructure. Application layer = `use-cases`; the Mongo/R2/
  Brevo/OpenAI/worker code = `adapters`/`infrastructure`.
- **Adapters:** `<Technology><Port>` — `R2ObjectStore implements ObjectStore`,
  `MongoUserRepository implements UserRepository`, `OpenAiChatGateway implements
  LlmGateway`, `BrevoEmailSender implements EmailSender`. Test doubles:
  `InMemoryUserRepository`, `FakeEmailSender`, `FakeLlmGateway`.
- **Use-cases:** verb phrase, one per file. `run-embroidery-pipeline.ts` →
  `RunEmbroideryPipeline`. Either a class with `.execute(input)` or a factory
  `createRunEmbroideryPipeline(deps)`.
- **Factories:** `createX()`. Top-level wiring: `createContainer(ctx)`.

## Client architecture (target)

**Server-first, deliberately _not_ the server hexagon.** The client gets the
hexagon's *spirit* — pure behavior testable without UI, IO behind interfaces —
via hooks, not layers.

- **Server-first boundary:** Server Components by default; Client Components only
  where interactivity needs them. Mutations via **Server Actions** (thin driving
  adapters); Route Handlers for webhooks / 3rd-party callbacks / the public tool
  APIs. **Import ban:** the client tree never imports `domain/`/`application/`/
  `infrastructure/`/`composition/` — its only server contract is Server Action
  calls + the DTOs they return.
- **Feature-first vertical slices:** `features/<feature>/` holds its Components +
  hooks together (chat, embroidery, contact, auth). Shared primitives stay in
  `components/ui/` (the shadcn-style Radix + CVA primitives already there).
- **Client state — server-first:** local UI state in the owning hook,
  shareable/navigational state in the **URL**. No global store.

## Cross-cutting decisions (target — adapted from psychable)

These are inherited from the reference model and are the conventions the refactor
adopts. Where the portfolio's reality differs from psychable, it is called out.

- **Use-case I/O:** plain DTOs in and out — never domain entities across the
  use-case boundary. Output DTOs are mandatory at the RSC boundary (entities
  aren't serializable into Client Components).
- **Validation, two tiers:** *structural* (shape/types/format) at the driving
  adapter via a schema, before the use-case runs; *business invariants* in the
  domain via value-object/entity construction. The portfolio already has the
  seeds of this — `validateSize`, `validateCustomerId` in the embroidery
  pipeline are domain invariants enforced at construction.
- **Reads:** single-item reads return full entities; list reads (cards, the
  `/projects` grid, blog index) return sparse projection DTOs.
- **Errors:** `Result<T, E>` for expected failures, `throw` for exceptional
  faults; one `AppError` type; logged once at the driving-adapter boundary with
  secret redaction. (Today: ad-hoc `throw` + `console.error`; the embroidery
  pipeline's `perr()`/`step()` is the closest existing pattern.)
- **DI & lifecycle:** stateless singleton adapters + a per-request
  `createContainer(ctx)`. Request-scoped state is never stored on an adapter.
  (Today: module-singleton clients — `mongodb.ts`, `r2.ts` — are already
  stateless singletons; there is no container yet.)
- **No payments, no transactions (yet).** Unlike psychable, this app has no
  Stripe and no multi-document transaction discipline. Don't import those
  sections of the reference model.

## Where to go next

- [`data-and-content.md`](data-and-content.md) — the JSON/Markdown content model and the getter → `ContentSource` boundary.
- [`auth.md`](auth.md) — NextAuth + magic-link + per-surface API keys, and the session/identity ports.
- [`external-services.md`](external-services.md) — MongoDB, R2, OpenAI, Brevo, the cache — each as a driven adapter.
- [`worker.md`](worker.md) — the two workers: in-process cron and the Python compute microservice.
- [`embroidery.md`](embroidery.md) — the embroidery pipeline as a vertical slice.
- [`migration.md`](migration.md) — the current flat layout → target mapping, and the out-of-scope fence.

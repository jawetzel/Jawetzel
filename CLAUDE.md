<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- SEEDED HEXAGONAL STANDARD — READ THIS BANNER FIRST, THEN ADAPT.            -->
<!-- ════════════════════════════════════════════════════════════════════════ -->

> ## ⚠️ Seeded standard — copied from `weekendplant`, adapt the project specifics
>
> This `CLAUDE.md` (and `AGENTS.md` + the generic `docs/architecture/*`) was **copied
> from the sibling `weekendplant` project** as the canonical hexagonal-architecture
> standard, **replacing jawetzel.com's previous project-specific `CLAUDE.md`**
> (recoverable via `git` history — it documented the embroidery/chat/supply-feed
> migration in detail). Read it as follows:
>
> - **Authoritative as-is — the standard for every migrated slice:** the
>   **Architecture (server-side)**, **Ports**, **Naming conventions**, **Use-case
>   I/O & validation**, **Error strategy**, **Dependency injection & lifecycle**,
>   **Client architecture**, and **Testing** sections.
> - **Ignore until adapted — weekendplant-specific:** the gardening **`## Project`**
>   section, the plant / combo / `lookups` domain examples, the forest-green palette
>   tokens, and pointers to `TODO.md` / `docs/conventions/weekendplant-*.md` /
>   `docs/architecture/migration-plan.md` (not copied). **This project is jawetzel.com**
>   — a portfolio hosting live tools (the embroidery pipeline, a raster→SVG vectorizer,
>   a resume-aware AI chat). Its real domain detail lived in the prior `CLAUDE.md`; pull
>   it back from git when adapting.
> - **Layout difference (important):** this project keeps the **`src/` layout**
>   (`@/* → src/*`); its hexagon lives under **`src/domain`, `src/application`,
>   `src/infrastructure`, `src/composition`** — **not** weekendplant's repo-root layers.
>   The shipped **`.dependency-cruiser.cjs`** and the new `eslint.config.mjs` env-guard
>   target `src/…`. Run them with `npm run depcruise` / `npm run lint` **after
>   `npm install`** — `dependency-cruiser`, `eslint`, and `eslint-config-next` were added
>   to devDependencies (this project previously had no ESLint set up).
> - **Docs note:** the generic standard docs were added under `docs/architecture/`
>   (overwriting `auth.md`). Your **prior project-specific docs** —
>   `overview.md`, `data-and-content.md`, `external-services.md`, `worker.md`,
>   `embroidery.md`, `migration.md` — were **left in place** and now coexist with the
>   standard set. Delete them (or fold them in) when you want a single clean standard.

<!-- ════════════════════════════════════════════════════════════════════════ -->

@AGENTS.md

# Weekend Plant

> **Migration status (June 2026):** This project is **mid-migration** from a conventional `src/`-based Next.js layout to the hexagonal architecture described below. **The architecture in this document is the target**, enforced by `.dependency-cruiser.cjs` once layers land at the repo root. Today most code still lives under `src/` in the old layout (generic `lib/data` CRUD, route handlers with inline auth/logic). We migrate **one vertical slice at a time**, via `Workflow` orchestration. When you work a slice, move it into the hexagon and repoint it at the shared modules; **do not assume the hexagon already exists for un-migrated areas.** The as-built conventions being superseded are preserved at `docs/conventions/weekendplant-conventions.md`; the *why* behind each target rule lives in `docs/architecture/`.

## Project

- **What it is:** an informational gardening website focused on food and flower gardening. Every post is a structured, visual weekend-project guide (hero image → quick facts → engaging description → materials list → step-by-step instructions).
- **Content domains:** how-tos, plants, combos, garden-skills, and lookups (controlled vocabularies). Phase 1 is content-only; **Phase 2 adds e-commerce** (selling kits/materials related to the guides — scope TBD).
- **Stack (target):** Next.js (App Router) + React + Tailwind CSS v4 + TypeScript (strict). Path alias `@/*` → repo root. Pin exact versions in `package.json`; framework-version gotchas go in `AGENTS.md`.
- **Persistence:** MongoDB on **Atlas** (managed; replica set by default → multi-document transactions are available). The app connects over a connection string; the database is **not** colocated with the app host.
- **Deployment:** **Railway** — the app runs as a Web Service from the repository root, with an in-process background worker (cron).
- **Object storage:** **Cloudflare R2** — images live in the store and are served **directly from R2**, not proxied through Next.js. Behind an object-store port. → `docs/architecture/object-storage.md`.
- **Auth (Phase 1):** **admin-only.** Public-facing user accounts are out of scope until Phase 2. **The exact admin-auth mechanism is still being decided** (see `TODO.md`) — the template's app-issued JWT-session pattern (`docs/architecture/auth.md`) is available to adopt but is **not yet a committed decision** for this project. Authz, when wired, is a single privileged **`admin` boolean** on the user document — **not** a role enum, set out-of-band in the DB.
- **Payments (Phase 2 · optional):** deferred — no billing in Phase 1. Pattern available at `docs/architecture/payments.md` when e-commerce is scoped.
- **Background work:** an in-process worker drip-publishes draft content and posts to social on cron schedules. These cron jobs are **entry-point driving adapters** — they must call application use-cases, **not** embed business logic (e.g. the "publish N drafts every 6 days" selection becomes a use-case).
- **Testing (normative):** **Vitest** — wired and load-bearing. See **`## Testing`**. E2E scope is decided per project; until decided, "thin driving adapters + fully unit-tested use-cases" is the load-bearing safety net.
- **Status:** Phase 1, **live** content site, **mid architecture-migration**. A decision recorded here means its *approach* is fixed; its *implementation* may still be design-later (see `TODO.md`).

## Controlled vocabularies — the `lookups` collection (pattern)

Weekend Plant's controlled vocabularies (categories, tags, facets) live in a Mongo **`lookups`** collection — the **single canonical list**. Valid category keys come from an enum in `application/` (re-exported, never hardcoded at call sites). **Content documents store only the value string, never a foreign key** into `lookups`; a unique index + use-case validation keep them consistent. → `docs/architecture/types-vocabulary.md` (generic spec; `types` there == `lookups` here).

## Commands

### `write it up`

When the user says **"write it up"**, follow the protocol in [`write_it_up.md`](write_it_up.md). It is a **code-state checkpoint** (invoked when the user is satisfied with the code): sync the human/spec docs, maintain and run the unit tests (the suite must be green), and **prepare — not execute — a git commit message**. It does **not** maintain architecture decisions; those live in this file and `TODO.md`.

## Architecture (server-side)

Hexagonal / Ports & Adapters (a.k.a. Clean / Onion). **This governs server-side code only.** Client/front-end architecture is a separate concern (**Client architecture**, below) — do not conflate the two.

### Layers & dependency rule

| Folder | Holds | May depend on |
| --- | --- | --- |
| `domain/` | Entities, value objects, pure business rules, domain errors. **Zero I/O.** | nothing |
| `application/` | Use cases (orchestration) + `application/ports/` (the interfaces) | `domain` |
| `infrastructure/` | Adapters implementing ports (email, DB, R2, AI, 3rd-party) | `application/ports` (inward only) |
| `composition/` | Factories / DI container | everything — **only** place allowed to import concrete adapters |
| `app/` | Next.js routing only | `application`, `composition` |

**Dependency direction:** `app/` → `application` → `domain`. `infrastructure` depends *inward* onto `application/ports`. Never the reverse. Enforced by `.dependency-cruiser.cjs` (`npm run depcruise`).

**Driving adapters** = Server Components, Route Handlers, Server Actions, **and cron jobs**. Keep them thin: parse input, call a use case, render/return. **No business logic in `app/` or the worker.**

### Ports

- **Consumer-owned.** Default location `application/ports/`. Use `domain/ports/` only when a pure domain service is the actual consumer.
- Name by **role/capability, not technology**. No `I` prefix.
- Role suffixes: `*Repository` (persistence), `*Sender`/`*Notifier` (messaging), `*Gateway`/`*Client` (3rd-party API), `*Provider` (config/clock/ids).

### Naming conventions

- **Never use the word `services`** as a layer or folder name — it is ambiguous between application and infrastructure. Application layer = `use-cases`; email/DB/R2 = `adapters`/`infrastructure`.
- **Adapters:** `<Technology><Port>` — e.g. `MongoPlantRepository implements PlantRepository`. Test doubles: `InMemoryPlantRepository`, `FakeEmailSender`.
- **Use cases:** verb phrase, one per file. `publish-plant.ts` → `PublishPlant`. Either a class with `.execute(input)` or a factory `createPublishPlant(deps)`.
- **Factories:** `createX()`. Top-level wiring: `composeContainer()` / `createContainer()`.

### Use-case I/O & validation

- **Plain DTO in, plain DTO out.** Use cases accept a serializable input/command DTO (primitives only) and return an output DTO / read model. **Never** accept or return domain entities across the use-case boundary.
  - Input/output DTO **types are owned by the application layer** (the use case's public contract).
  - Output DTOs are mandatory at the RSC boundary — domain entities/value objects are not serializable into Client Components.
  - Entity → DTO mapping is explicit and named (e.g. `toPlantView(plant)`), at the edge of the use case.
- **Always-valid domain.** Business invariants live in the domain and are enforced when the use case constructs value objects/entities. Use cases do **not** hand-validate business rules with scattered `if`s.
- **Two-tier validation:**
  - *Structural* (shape, types, required, format) → at the driving-adapter boundary via a Zod schema, before the use case is invoked.
  - *Business invariants* → in the domain, via value-object / entity construction.
- **Schema location = colocated with the use case in `application/`** (single source of truth). Driving adapters import and run it; every entry point (Server Action, Route Handler, cron job) validates identically.

Flow: `adapter: untrusted input → Zod parse → Input DTO → useCase.execute(dto)` → `useCase: construct value objects/entities (invariants) → orchestrate ports/domain → map → Output DTO` → `adapter: render / JSON`.

### List reads — projection at the port

Two read shapes, two port boundaries. **Single-item reads** (`findBySlug`/`findById`/detail/write-path loads) return the **fully-rehydrated domain entity**; the use case maps entity → DTO. **List reads** (browse cards, list rows, count badges, any many-row view) run `find().project().sort().limit()` server-side and return a flat **`<Entity>Projection` DTO array** directly — no entity rehydration, no full-document transfer. → `docs/architecture/list-reads-projection.md`.

### Error strategy

**Hybrid:** `Result<T, E>` for *expected* failures (control flow); `throw` for *exceptional* faults (bugs, infra down).

- **`AppError` base** (domain / shared kernel) carries: `code` (stable, machine-readable), `category` (`validation | domain-invariant | business-rule | unexpected`), `message`, `context` (a small structured bag of *relevant* operands — never a state dump), `cause` (native `Error.cause`).
- **Three failure categories:** *structural* (Zod at the boundary), *domain-invariant* (value-object/entity construction), *business-rule* (use case returns `Result.err(AppError)`).
- **Enrich by cause-chain:** a layer that catches and rethrows wraps with `new XError(msg, { cause })` and adds operands to `context`. Original stack/cause is never lost.
- **Log/report exactly once, at the driving-adapter boundary** — never per layer.
- **Redaction is mandatory.** `context` and any captured input pass a secret-key allowlist/denylist at serialization time (`password`, `token`, `authorization`, …), defined once at the logging boundary.

### Dependency injection & lifecycle

**Hybrid: stateless singletons + a per-request container.**

- `composition/` exposes a **per-request `createContainer(ctx)`** factory — never a bare process-level `container`. Called at the driving-adapter entry point; carries only request-scoped state (current user, active transaction).
- **All infrastructure adapters are stateless process singletons** — the `MongoClient` (owns the driver's connection pool), repositories, `EmailSender`, configured SDK clients, config, clock. Created once at module scope and injected into the per-request container.
  - **Hard rule:** never store request-scoped state on an adapter instance.

#### Transactions

- **Requires a replica set** (satisfied by Atlas). A unit of work opens a **client session** (`client.startSession()`) — the session, not a borrowed connection, is the request-scoped handle.
- Port `TransactionManager` (consumer-owned → `application/ports/`), implemented by singleton infra adapter `MongoTransactionManager`. Shape is a **scope function**: `run<T>(work: (tx: Tx) => Promise<T>): Promise<T>` via `session.withTransaction(...)`.
- **Transaction threading is explicit:** repo methods take the `tx` as an argument — `plantRepo.save(plant, tx)` — and pass `{ session }` to every driver operation. **No AsyncLocalStorage** for transactions.

### Testability goal

Every layer must be unit-testable in isolation by injecting fakes through the factories. Domain is pure (test directly). Application gets in-memory/fake adapters. Infrastructure adapters are integration-tested.

## Client architecture

**Server-first, deliberately _not_ the server hexagon — the client gets the hexagon's spirit (pure behavior testable without UI, IO behind interfaces) via hooks, not layers.** → `docs/architecture/client.md`.

- **Server-first boundary:** Server Components by default; Client Components only where interactivity needs them. Mutations via **Server Actions** (thin driving adapters: parse → use-case → render); Route Handlers only for webhooks / 3rd-party callbacks / public JSON. **Import ban:** the client tree never imports `domain/`/`application/`/`infrastructure/`/`composition/` — its only server contract is Server Action calls + the Output DTOs they return.
- **Decompose on seams, not size:** re-render cadence · data dependency · nameability · rule-of-three reuse. Over-decomposition (pass-through wrappers, `*Inner` names) is a first-class failure.
- **Hooks are the only home for client behavior** — extract on a **closed loop** (state + transitions + effects), nameable as a capability, **testable without rendering**.
- **Feature-first vertical slices:** `features/<feature>/` holds its Components + hooks together. Shared primitives in `components/ui/`.
- **Client state — server-first:** no global store; local UI state in the owning hook, shareable/navigational state in the **URL**.
- **Public-facing forms:** a failed submit **names and highlights** the offending fields — never a generic error. **No raw-JSON entry** (real inputs + add/remove rows). **Multi-line prose = a shared rich-text editor** storing **server-sanitised** HTML.
- **Styling: Tailwind v4 + shadcn/ui only** — the sole UI-primitive source, in `components/ui/`; themed via CSS variables to the project palette. **Never hardcode colors** — always reference tokens. Weekend Plant's palette is the 23-token WCAG-AA system derived from anchor `#2d6a4f` (forest green): primary `#2f684f`, accent `#a67530`, ink `#161817`. **`src/app/globals.css` (`@theme inline` + `:root`) is the single source of truth**; the full token table + usage rules are preserved in `docs/conventions/weekendplant-conventions.md` until folded into the migrated client layer.
- **Testability:** hooks unit-tested without rendering; components with fake hooks / DTOs injected.

## Testing (normative)

**Vitest, normative; the suite must be green before any `write it up` checkpoint.** Derive every test decision from *this* project's architecture. → `docs/architecture/testing.md`.

- **Runner:** Vitest (`globals: true`). `test` = `vitest run` (the gate), `test:watch` = `vitest`. Client tests use RTL + jsdom + `jest-dom` + `user-event` per the framework's official Vitest guide.
- **Shape-follows-architecture:** server tests by hexagon ring; client tests colocated in the feature slice. Fakes (`*.fake.ts`) live with their port.
- **Layer table:** domain pure/direct · use-cases via injected port fakes (never real infra) · ports get **one shared contract test run against both the fake and the real adapter** · infrastructure adapters integration-tested against the real dependency · client hooks tested without rendering · components with fake hooks/DTOs.
- **`Result`/`AppError`:** assert on `code`/`category`, never message prose or stacks; a **redaction security test** (no secrets in serialized errors/logs) is mandatory.
- **Migration note:** existing tests live in `tests/unit/` with a shared mock-DB factory (`tests/unit/mocks/db.ts`). As slices move into the hexagon, retarget their tests to the layer table above; the mock-DB factory is superseded by port fakes + adapter integration tests.

## Open / deferred — see `TODO.md`

`TODO.md` tracks decided-but-undesigned directions and deferred decisions. A decision recorded in *this* file means its **approach** is fixed; its **implementation** may still be design-later. **Do not implement anything that lives only in `TODO.md`.**

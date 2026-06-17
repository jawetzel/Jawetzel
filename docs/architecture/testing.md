# Testing — Architecture

> **Template pattern.** `CLAUDE.md` carries the summary; this is the full rationale, the layer-by-layer table, and the responsive-UI seam.

## 0. First principle

**Tests are derived from _this_ project's architecture — never "because another repo does it."** The hexagon + client-slice split *is* the test plan: each ring has a natural test style, and the boundaries between rings are exactly where fakes go.

## 1. Stack

- **Runner:** Vitest.
- **Client:** React Testing Library + jsdom + `@testing-library/jest-dom` + `@testing-library/user-event`.
- **Per the framework's official Vitest guide for the installed version** — the authoritative stack pairing; don't substitute from memory (see `AGENTS.md`).
- **Two Vitest projects** in one config (`vitest.config.mts`):
  - **`server`** — Node environment, for `domain`/`application`/`infrastructure` + `composition`.
  - **`client`** — jsdom environment, for `features/` + `components/`.

## 2. Shape follows architecture

```
server tests  → tests/<ring>/…           (centralized, by hexagon ring)
client tests  → features/<slice>/…        (colocated with the slice)
fakes         → live with the port they fake
```

- **Server tests are centralized** under `tests/` by ring (`tests/domain`, `tests/application`, `tests/infrastructure`) — mirrors the hexagon.
- **Client tests are colocated** in the feature slice — a slice owns its components, hooks, *and* their tests.
- **Fakes live with their port** (`application/ports/__fakes__/` or alongside) — one fake per port, reused everywhere.

## 3. The layer-by-layer table

| Layer | What | How tested | Doubles |
| --- | --- | --- | --- |
| **Domain** | entities, value objects, pure rules | call it directly; assert outputs/throws | none (pure) |
| **Application** | use-cases | inject **fake ports**; assert orchestration + `Result` | fakes for every port |
| **Ports** | the interface contracts | **one contract test per port**, run against **both** the fake and the real adapter | — |
| **Infrastructure** | adapters (DB, object store, payments, email) | **integration test** against the real dependency | real dep (test instance) |
| **Composition** | DI wiring | smoke: container builds, singletons singletonized | — |
| **Client hooks** | behavior | `renderHook`, no component mount | fake callbacks/DTOs |
| **Client components** | render | render with fake hook output / injected DTOs | fake hooks |

## 4. The contract-test pattern (ports)

The crux of trustworthy fakes:

- Every port has **one shared contract test** — a suite parameterized over an implementation.
- Run it against **the fake** (used by use-case tests) **and** the **real adapter** (integration).
- If the fake and the real adapter both pass the same contract, **use-case tests that rely on the fake are trustworthy.** This is what makes "test against fakes" safe.

```ts
// contract: describe-block exported, run twice with different factories
export function userRepositoryContract(make: () => UserRepository) { … }
// fake.test.ts → userRepositoryContract(() => new InMemoryUserRepository())
// mongo.int.test.ts → userRepositoryContract(() => new MongoUserRepository(testDb))
```

## 5. The mocking boundary

- **Mock only at ports.** Use-cases get fake ports; nothing else is mocked.
- **Never mock the domain.** It's pure — use the real thing.
- **Never mock what you don't own** beyond the port boundary — wrap it in a port, fake the port.
- **No `vi.mock` of internal modules** to patch behavior — inject a fake through the factory instead. If you're reaching for module mocking, the seam is wrong.

## 6. Result / AppError assertions

- Assert on **`code` and `category`**, never message prose or stack contents.
- Expected failures: assert `Result.err` with the right `code`.
- A **redaction security test is mandatory**: serialize an error carrying secret-shaped fields, assert none leak (see Error strategy in `CLAUDE.md`).

## 7. The responsive-UI seam

The one place UI correctness can't be fully unit-tested:

- **Behavior** (the hook) is viewport-agnostic and unit-tested.
- **Layout** (Tailwind breakpoints) is verified by a **build + manual browser check** at both viewports (desktop + mobile) — an **accepted gap**, documented, not silently ignored.
- If a responsive concern has *logic* (e.g. "collapse menu below md"), that logic goes in a hook (`useMediaQuery`-style) and **is** unit-tested; only pure CSS layout is the manual gap.

## 8. What this rejects

- **E2E as the default safety net** — decide its scope per project. If out of scope, the invariant that replaces it is **thin driving adapters + fully unit-tested use-cases**: if logic lived in routes/actions, we'd need E2E; because it lives in use-cases, unit tests suffice. (If E2E *is* in scope, it complements — never replaces — the unit layer.)
- **Testing through the UI what a hook could test directly** — push behavior into hooks.
- **Mocking internals** — fakes at ports only.
- **Snapshot-everything** — assert on behavior and explicit output, not giant snapshots.

## 9. Scripts

```
npm test           → vitest run     (the gate; must be green before write it up)
npm run test:watch → vitest         (dev loop)
```

→ See also: `CLAUDE.md` (summary), `client.md` (client test seam), each port's contract test.

# Client Architecture — Full Specification

> **Template pattern.** `CLAUDE.md` carries the summary; this is the full rationale + rules.
> **Scope:** everything in the React/Next client tree — Server Components, Client Components, hooks, Server Actions as seen from the client, state, forms, styling. The server hexagon (`domain`/`application`/`infrastructure`/`composition`) is a separate concern.

## 0. First principle

**Server-first. The client is deliberately _not_ the server hexagon.** We don't port layers/ports/adapters into React. Instead the client gets the hexagon's *spirit* — pure behavior testable without UI, IO behind interfaces — through **hooks and the RSC/Server-Action boundary**, not through a layered folder taxonomy.

The goal: a server-first app where Client Components are the exception, behavior lives in testable hooks, and the only contract with the server is **Server Action calls + Output DTOs**.

## 1. The server/client boundary

- **Server Components by default.** A component is a Server Component unless it *needs* to be a Client Component (interactivity, browser APIs, hooks like `useState`/`useEffect`).
- **`'use client'` is a deliberate boundary, not a default.** Push it as far down the tree as possible — a leaf that needs interactivity, not a whole page.
- **Mutations go through Server Actions.** A Server Action is a thin driving adapter: parse → use-case → return DTO. **No business logic in the action.**
- **Route Handlers** (`app/api/**`) only for webhooks / 3rd-party callbacks / non-React consumers. In-app mutations use Server Actions, not `fetch('/api/...')`.
- **The import ban (hard rule):** the client tree **never** imports `domain/`, `application/`, `infrastructure/`, or `composition/`. The only server contract is calling a Server Action and consuming the **Output DTO** it returns. This keeps the server swappable and the client genuinely decoupled.

## 2. What is a Client Component for

Only reach for `'use client'` when the component needs one of:
- Local interactivity/state (`useState`, `useReducer`).
- Lifecycle/effects (`useEffect`, subscriptions).
- Browser-only APIs (`window`, `localStorage`, `IntersectionObserver`).
- Event handlers beyond `<form action>` (drag, hover, keyboard).
- Context providers consumed by client subtrees.

Everything else — data fetching, composition, static markup — stays a Server Component.

## 3. Component decomposition — on seams, not size

Decompose when there's a real **seam**, not when a file feels long:
- **Re-render cadence** — split a frequently-re-rendering island from static siblings.
- **Data dependency** — a subtree that needs different data/props.
- **Nameability** — if you can give it a clear, single-responsibility name, it's a real component.
- **Rule-of-three reuse** — used 3+ times ⇒ promote to a shared component.

**Over-decomposition is a first-class failure.** Pass-through wrappers that just forward props, `*Inner` components, splitting a cohesive unit into five files you have to read together — all rejected. A component should earn its existence.

## 4. Hooks — the only home for client behavior

**All non-trivial client behavior lives in a hook.** A Client Component should read as: call hooks → render. No business logic inline in the component body.

A behavior earns a hook when it's a **closed loop**: state + the transitions that mutate it + the effects that sync it. Extract when:
- It's **nameable as a capability** — `useDisclosure`, `useDebouncedValue`, `useCheckoutForm`.
- It's **testable without rendering** — the whole point. A hook's logic is verified by calling it, not by mounting a component. If you need a DOM to test it, the seam is wrong.
- It has a **closed loop** — owns its state and the rules for changing it.

**Layer hooks (mirrors the hexagon's spirit):**
- **Primitives (layer 1):** generic, domain-free — `useDisclosure`, `useDebouncedValue`, `useLocalStorage`. Live in a shared hooks home. Rule-of-three gated.
- **Domain hooks (layer 2):** encode app concepts — `useCart`, `useAvailability`. Compose primitives.
- **Feature hooks (layer 3):** orchestrate one feature's screen — `useCheckoutForm`. Live in the feature slice.

**Reuse for shared _behavior_, not shared _lines_.** Two hooks that happen to look similar but model different concepts stay separate. Don't DRY a `useCart` and a `useWishlist` into one hook because the code rhymes.

**Widely-reused hooks return stable identities** — memoize returned objects/callbacks (`useCallback`/`useMemo`) so consumers don't re-render needlessly. A layer-1 hook used everywhere must not be a re-render source.

## 5. Feature-first vertical slices

Code is organized by **feature**, not by layer:

```
features/
  checkout/
    components/        # Client + Server Components for this feature
    hooks/             # feature + domain hooks (useCheckoutForm, …)
    actions.ts         # Server Actions (thin; call use-cases)
    types.ts           # view-model/DTO types as seen by the client
    index.ts           # public surface of the slice
```

- **Feature-first, not layer-first.** No global `components/`, `hooks/`, `actions/` mega-folders. A feature owns its components + hooks + actions together.
- **Shared primitives** (`components/ui/`, layer-1 hooks) are the *only* cross-feature folders — and they're rule-of-three gated.
- A slice's **`index.ts`** defines its public surface; cross-feature imports go through it, not into a slice's internals.

## 6. Client state — server-first, one carve-out

**No global client store. Redux/Zustand/Jotai rejected as the default.** State lives in one of four places, in order of preference:

1. **Server state** — the server owns the data. Fetch in RSC, mutate via Server Action, re-render. Not "client state" at all.
2. **URL** — shareable/navigational state: filters, tabs, pagination, selected item. `searchParams` are the store. Survives refresh, shareable, back-button works.
3. **Local component/hook state** — ephemeral UI: open/closed, hover, input-in-progress. Lives in the owning hook.
4. **React Context** — only for genuinely tree-wide, low-churn values (theme, current user, locale). Never as a state-management workaround.

**The one carve-out: a genuinely complex editor** (e.g. a CMS / page-builder — undo/redo, dirty-tracking, a tree of blocks). That is the single place a scoped reducer / state machine is justified — and it stays **scoped to that feature**, not global.

## 7. Data fetching & mutation

- **Reads:** in Server Components, call the use-case (server-side) and pass **Output DTOs** down as props. Client Components receive data, they don't fetch it (except for client-only concerns).
- **Mutations:** Server Actions. The action validates (Zod, shared with the use-case), calls the use-case, returns a typed `ActionState`.
- **No client-side data layer** (no React Query/SWR as the default) — the server is the data layer. Add one only if a genuine client-cache need appears (and document why).
- **Optimistic UI** via `useOptimistic` where it helps; the Server Action remains the source of truth.

## 8. Forms

Public-facing forms are a quality surface — they get explicit rules:

- **Failed submit names and highlights the offending fields.** Never a generic "something went wrong." The `ActionState` carries `fieldErrors: Record<string, string>`; each field renders its own error; the form summarizes.
- **Required fields gate client-side too** — disable submit / show inline required markers before the round-trip, but the server (Zod) is authoritative.
- **No raw-JSON entry, ever.** Structured data is entered through real inputs with add/remove rows — never a `<textarea>` of JSON. (Hard rule.)
- **Multi-line prose is the shared rich-text editor** (e.g. Tiptap) storing **server-sanitized HTML**. Not a bare textarea, not per-feature editors. (Hard rule.)
- **`ActionState` shape** is shared: `{ ok: true, data } | { ok: false, formError?, fieldErrors? }`. A shared `<FormErrors>` + per-field error rendering consume it.
- Server Actions validate with the **same Zod schema** the use-case uses — one schema, both sides.

## 9. Styling

- **Tailwind v4 + shadcn/ui only.** shadcn/ui is the **sole** source of UI primitives; they live in `components/ui/` and are owned/edited in-repo.
- **Theme via CSS variables** mapped to the brand palette — Weekend Plant's tokens derive from anchor `#2d6a4f` (forest green): primary `#2f684f`, accent `#a67530`, ink `#161817` (23-token WCAG-AA system). Defined in `src/app/globals.css` (`@theme inline` + `:root`); the full table + usage rules live in `docs/conventions/weekendplant-conventions.md`. Display + body fonts are still TBD (see `TODO.md`).
- **Never hardcode colors.** Use the semantic tokens (`bg-primary`, `text-muted-foreground`), never a literal hex or `bg-[#...]` in components.
- **Mobile-first.** Default styles target mobile; layer `md:`/`lg:` up. Both viewports are first-class (see `testing.md` → responsive seam).

## 10. Testability (mirrors the hexagon's goal)

- **Hooks tested without rendering** — the core promise. Logic in hooks ⇒ verified by calling them (`renderHook`), no component mount.
- **Components tested with fake hooks / injected DTOs** — a component takes data + callbacks; tests pass fakes. The component is a thin render of hook output.
- **The seam test:** if a behavior can't be tested without a DOM, it's in the wrong place — push it into a hook.
- **Server Components** that just compose + fetch are verified by the use-case tests behind them + a smoke render; async RSCs aren't unit-tested (React/Vitest limit, see `testing.md`).

## 11. What this rejects (and why)

- **Client tree importing server rings** — breaks decoupling; the boundary is Server Actions + DTOs.
- **Global state stores by default** — server-first + URL + local hooks covers it; a store is a last resort, scoped.
- **Layer-first folders** (`components/`, `hooks/`, `actions/` as top-level buckets) — feature slices instead.
- **Business logic in components or actions** — components render hook output; actions call use-cases.
- **Raw JSON textareas, per-feature rich-text editors, generic form errors** — all explicitly banned.
- **A client data-fetching library as default** — the server is the data layer until proven otherwise.

→ See also: `CLAUDE.md` (summary), `testing.md` (client test stack + responsive seam), `auth.md` (the principal carried into RSCs).

# List Reads — Projection at the Port

> **Template pattern.** `CLAUDE.md` carries the summary; this is the full design.

## 1. The problem

On the production build this came from, a content-heavy index page pulled **tens of MB** to render a few cards, turning a home page into a **multi-second** load. Repository `findAll`-style methods rehydrated **full domain entities** for list views that needed 4–5 fields per row. At scale this is a cliff.

Root cause: **one read shape for everything.** Detail pages (need the whole entity) and list/card views (need a handful of fields) went through the same `find()` → full-document → entity-rehydration path.

## 2. The decision

**Two read shapes, two port boundaries:**

| Read shape | Port method returns | Path |
| --- | --- | --- |
| **Single-item** (detail, write-path load) | **fully-rehydrated domain entity** | `findBySlug`/`findById` → entity → use-case maps to DTO |
| **List** (cards, rows, counts, walls) | **flat `<Entity>Projection` DTO array** | `find().project().sort().limit()` → DTO **directly** |

- **Single-item reads** keep the always-valid-domain guarantee — the whole document is present, the entity is constructed, invariants hold.
- **List reads** skip entity rehydration entirely — project to the fields the view needs at the **database**, return a flat DTO array. No multi-MB transfer, no constructing thousands of entities to drop most of their fields.

## 3. Why not just rehydrate and map?

- Rehydrating an entity to then drop 90% of its fields is the exact waste that caused the slow page.
- The always-valid-domain invariant matters **where you mutate** — the write path and detail views. A read-only card list never mutates; constructing a full entity to render a name + thumbnail buys nothing.
- So: **entities where invariants matter (single-item, writes); projections where they don't (lists).**

## 4. Naming & placement

- **Projection DTO:** `<Entity>Projection` — e.g. `UserCardProjection`, `ProductRowProjection`. Lives in the application layer (the read model is part of the use-case's contract), alongside the use-case that returns it.
- **Port methods:**
  - single: `findById(id): Promise<Entity | null>` / `findBySlug(slug): Promise<Entity | null>`
  - list: `listCards(filter): Promise<EntityProjection[]>` — named for the view, returns projections.
- **The projection is the read model** — shaped for the consumer (card grid, table row), not a generic partial of the entity.

## 5. Adapter shape (`$facet` for list + count)

A list view usually needs the page of rows **and** a total count (pagination, "123 results"). One aggregation, `$facet`:

```
db.collection.aggregate([
  { $match: filter },
  { $facet: {
      rows:  [ { $sort }, { $skip }, { $limit }, { $project: <projection fields> } ],
      total: [ { $count: 'n' } ],
  }},
])
```

- **Project at the DB**, not in app code. The `$project` names exactly the projection fields.
- A **covering index** over `(filter, sort, projected fields)` makes it an index-only scan where possible.

## 6. Rules

1. **List/index/card/count views → projection.** Never load full entities for a list.
2. **Detail/write-path → entity.** Single-item reads rehydrate the full entity; invariants hold where it matters.
3. **Project at the port/DB**, not in application code — don't fetch the document and `.map()` it down in JS.
4. **The projection DTO is owned by the application layer** and named `<Entity>Projection` / `<Entity>CardProjection`.
5. **Covering index per list view** — the `$project` fields + sort + filter should be index-served where feasible.
6. **Fakes mirror the contract** — the in-memory repo's `listCards` returns the same projection shape (contract-tested both sides).

## 7. Rollout (slice by slice)

Migrate the worst offenders first (the home page and the largest lists), then the rest. For each slice:

- add the projection method + covering index,
- swap the use-case read to it,
- delete the old full-entity list path.

→ See also: `CLAUDE.md` (summary), `testing.md` (contract tests for the projection methods).

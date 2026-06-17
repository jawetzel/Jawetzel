# Types & Controlled Vocabularies — Architecture

> **Template pattern · optional module.** Delete if the app has no admin-managed controlled lists. `CLAUDE.md` carries the summary; this is the full design for the `types` collection.

## 1. The problem

Many apps have several **controlled vocabularies**: categories, tags, statuses, options, languages, credentials — any list of allowed values that:
- Powers a **filter facet** on a list/search.
- Constrains what a document can be **tagged** with.
- Needs **CRUD** (admins add/rename/retire values) **without a code deploy**.

Naïve approaches fail: hardcoded enums need deploys; a collection per vocabulary multiplies boilerplate; free-text tags drift into chaos.

## 2. The decision

The Mongo **`types`** collection is the **single canonical list of every controlled vocabulary**.

```
types {
  _id:      ObjectId
  category: string    // which vocabulary — e.g. 'category', 'tag', 'language'
  value:    string    // the allowed value — e.g. 'Spanish'
  count:    number    // denormalized usage count (how many docs use it)
}
```

- **Unique index on `(category, value)`** — no duplicate values within a vocabulary.
- `category` keys come from a **`TypeCategory` enum** in `application/` — re-exported, never hardcoded at call sites.
- Documents **store the value string**, never an FK into `types`. The unique index + use-case validation keep them consistent.
- `count` is denormalized for facet display ("Spanish (42)") — updated when docs are tagged/untagged.

## 3. Why one collection, not many

- **One CRUD surface** for every vocabulary — admins manage all controlled lists in one place.
- **One set of use-cases** (`AddTypeValue`, `RenameTypeValue`, `RetireTypeValue`, `ListTypeValues`) — not N per-vocabulary variants.
- **No join/FK overhead** — documents carry the value string directly; reads don't resolve references.
- Adding a new vocabulary = a new `category` enum entry, **no schema change, no new collection.**

## 4. Consistency model

- **Documents store the value string** (e.g. `tags: ['a', 'b']`), not FKs.
- **Validation at the use-case:** when a doc is tagged, the use-case checks each value exists in `types` for that category (rejects unknown values).
- **Rename is a migration:** renaming a `types` value updates the canonical row **and** rewrites the string in every doc that carries it (a use-case that does both in one unit of work — a transaction).
- **Retire ≠ delete:** retiring a value hides it from new-tag pickers but leaves existing tagged docs intact (or triggers an explicit migration). Never orphan data.
- **`count` upkeep:** incremented/decremented as docs are tagged/untagged; a periodic reconcile job can recompute from scratch (denormalized values drift).

## 5. Migration seeding vs. live CRUD

- **During migration (if any):** a one-off seed script derives the vocabulary from imported data (scan all docs, collect distinct values per category, seed `types`).
- **After migration:** **live data is the source of truth** — admins CRUD via the use-cases; the script is **not** re-run (it would clobber admin edits).
- The seed script is **idempotent** but **one-directional** — seed once, then hand off to live CRUD.

## 6. Testability

- **Domain:** value normalization (trim, case) is pure → tested directly.
- **Use-cases** (`AddTypeValue`, `RenameTypeValue`, …) — fake `TypeRepository`; assert validation + rename-migration behavior.
- **`TypeRepository` contract-tested** (fake + Mongo).
- **Rename-migration tested:** renaming a value rewrites all referencing docs in one unit of work (transaction).

→ See also: `CLAUDE.md` (summary).

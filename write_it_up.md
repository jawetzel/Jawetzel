# `write it up` — protocol

**Trigger:** the user says **"write it up"** (case-insensitive; also accept "write that up" / "write up").

**When:** invoked when the user is satisfied with the current state of the code and wants it checkpointed — documentation synced, unit tests maintained and green, and a commit message prepared for review.

**Scope:** this is a *code-state* checkpoint. It is **not** the architecture-*decision* step — decisions/conventions are maintained separately in `CLAUDE.md`. This checkpoint **does** reconcile the *status* of planned work against what it completed (`TODO.md` and any planning/status files), marking items done/partial and dropping closed lines, but it never *makes* a new architecture decision.

## Preconditions

- Run from the repo root.
- There are code changes since the last write-up. If there are none, report that and stop.

## Actions (in order)

### 1. Survey the changes

Inspect the `git diff`, untracked files, and the working session to identify every behavioural/logical change since the last write-up: new or changed user-facing actions, business rules, workflows, and states.

### 2. Check for notifications (optional — if the app sends transactional email/SMS)

For every behavioural/logical change from step 1, decide whether it should **fire — or stop firing — a per-user notification**. Treat this as **part of the change, not a separate loop** — silent state changes are how notification gaps accumulate.

- **New use-case / new domain event** — should it notify? If yes, wire it **in this checkpoint** (don't defer): add the template, dispatch from the use-case **after the unit of work commits** (never inside the transaction — see `CLAUDE.md` › Transactions), and record it in the notification catalog. If it's intentionally out of scope (digest, marketing, ops alert), say so in the report and move on.
- **Changed use-case** — does its existing notification still carry the right payload and link to the right surface? Update it if the change broke that.
- **Removed use-case** — remove the now-stale dispatch site and unused template.

The report (final step) names every notification wired, changed, removed, or deliberately deferred this checkpoint. _If the app has no notifications, skip this step and say so._

### 3. Maintain `/docs/application` (canonical technical spec)

The system of record for **rules and workflows**. Implementation-agnostic — **no code references** (no file paths, class names, or snippets). Quality bar: a competent team could **rebuild the entire system from these docs alone**.

- Foldering: `/docs/application/{role}/{section}.md`.
- Index: `/docs/application/index.md` lists every role and links each `{section}.md`.
- Each section documents, per action/workflow:
  - **Role** it applies to.
  - **Starting state** — preconditions, system and data state on entry.
  - **Ending state** — postconditions, system and data state on success.
  - **Rules & business logic**, *including logic the user never sees* — validation, authorization, side effects, sequencing, failure handling.
  - Edge cases, invariants, and any concept needed to reproduce behaviour without the code.

### 4. Maintain `/docs/user` (user stories / how-to)

The **user's-eye view** — what a person in each role does and experiences. Quality bar: usable to produce an end-user how-to, and to re-derive the product in any stack.

- Foldering: `/docs/user/{role}/{section}.md` (same convention as application docs).
- Index: `/docs/user/index.md` lists every role and links each `{section}.md`.
- Each section documents, per story: **what the user does**, **what they should see**, **starting** and **ending state** from the user's perspective.
- Keep consistent with the application docs (same roles/sections). User docs describe **experience**; application docs hold the **rules behind it**. Do not leak internal mechanics into user docs.

### 5. Sync the indexes

After writing/updating sections, update both `index.md` files so every role/section is linked and there are no dead or missing links.

### 6. Maintain unit tests

- Update or add unit tests to cover the **logical changes**, following the layer table in `CLAUDE.md` › Testing (domain direct, use-cases via fakes, ports via contract tests, client hooks without rendering).
- Run the project's unit-test command (`npm test` — Vitest `run`).
- Confirm the change did not break unrelated tests.
- **If any test fails: stop, report the failures, and do not produce a commit message.** A checkpoint must be green.

### 7. Maintain the changelog

A durable record of **what changed over time and _why_** — explicitly including **data migrations and data-processing runs** — partitioned by date so files stay small.

- Location: `changelog/` at the repo root.
- **Entry file:** `changelog/{YYYY}/{MM}/{DD}.md` — zero-padded (e.g. `changelog/2026/05/19.md`). **One file per day**; create the `{YYYY}/{MM}/` folders if missing. **Append** this checkpoint's entry — never rewrite earlier entries or prior days.
- **Per checkpoint, append one entry** containing:
  - A heading: the checkpoint time + the commit **subject** (kept in sync with step 8).
  - The **behavioural/logical changes** from step 1, grouped **Added / Changed / Fixed / Removed**.
  - **Why** — the reason and any decision behind each notable change (the problem it solves; what was chosen and what was rejected). **Required, not optional.**
  - **Data migrations & processing** — a **mandatory subsection whenever data was migrated, imported, backfilled, transformed, or re-processed**: dataset(s) and **source → target**, the transformation applied, **record counts / results**, idempotency, and **why** it was run. Record this **even when triggered ad hoc**.
  - Links to the touched `/docs` sections where relevant.
  - It is a *changelog, not a spec*: outcome- and reason-focused, high-level (no code dumps) — but **never omit the "why" or a data-migration run**.
- **Index:** `changelog/index.md` — a **newest-first** list linking every day file with a one-line summary per day. Update it every checkpoint; no dead or missing links.

### 8. Reconcile the planning files

Cross-check the work this checkpoint completed (step 1) against the planning/status files and bring them current. This is **status reconciliation, not decision-making** — mark what is done, surface what is newly open; never add or change an architecture decision here (that stays in `CLAUDE.md`). Verify status against the actual code/route state, not just prior claims.

- **`TODO.md`** — for every item this checkpoint advanced, update its status and note what shipped vs. what remains. Do **not** introduce new decisions or scope.
- **Any other planning/status files** the project keeps — drop the lines this checkpoint closed; add any newly-surfaced open item.
- If nothing in these files is affected, say so explicitly in the report rather than silently skipping.

### 9. Prepare the commit message

- Re-read the final `git diff`.
- Produce a commit **subject** (concise, imperative, < 70 chars) and **body** (what changed and why; note the docs and test updates) for the user to review.
- **Do not run any git command** (no `add`/`commit`/`push`). Output the message text only — the user commits.
- End the body with a `Co-Authored-By:` trailer naming the current model.

### 10. Report

Summarise: docs added/updated, the changelog entry written, the planning-file reconciliation (what was marked done/partial/dropped, or a note that none were affected), test results, the proposed commit message, any notifications wired/changed/removed/deferred (or a note that none were affected), and any assumptions or items needing the user's attention.

## Guardrails

- **No git actions in this protocol** — message text only. The user commits; git is their review mechanism.
- **Docs are implementation-agnostic** — no file paths, class names, or code in `/docs`.
- **Maintain incrementally** — update existing docs; do not regenerate from scratch or drop content that is still accurate.
- **Changelog is append-only & date-partitioned** — one file per day (`changelog/{YYYY}/{MM}/{DD}.md`); append new entries, never rewrite prior days; keep `changelog/index.md` newest-first and link-clean.
- Application docs may contain hidden business logic; user docs must not expose internal mechanics.
- **Planning files are status-reconciled, not decided** — this protocol may update `TODO.md` and status files to match completed work, but never makes or alters an architecture decision (those live in `CLAUDE.md`).
- **Notifications are part of the checkpoint, not deferred** — step 2 wires (or explicitly defers) every notification a new/changed/removed use-case implies.

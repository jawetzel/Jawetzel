@AGENTS.md
@.claude/rules/architecture.md
@.claude/rules/error-strategy.md
@.claude/rules/di-transactions.md
@.claude/rules/client-architecture.md
@.claude/rules/ux.md
@.claude/rules/testing.md

# jawetzel.com — portfolio & live tools

## Project

- **What it is:** a personal portfolio that also **hosts working tools**, not just
  screenshots of them — an embroidery pipeline, a raster→SVG vectorizer, and a
  resume-aware AI chat. The tools are the portfolio; they have to actually run.
- **Layer root: `src/`.** Path alias `@/* → src/*`. The hexagon lives under
  `src/domain`, `src/application`, `src/infrastructure`, `src/composition`, with routing
  in `src/app`. `.dependency-cruiser.cjs` and the `eslint.config.mjs` env-guard target
  `src/…`.
- **Stack:** Next.js (App Router) + React + Tailwind CSS v4 + TypeScript (strict).
- **Background work:** `worker/` — out-of-process jobs for the heavier tool pipelines.
  Cron/worker entry points are **driving adapters**: they call use-cases, never embed
  business logic.
- **Migration status:** mid-migration into the hexagon, one vertical slice at a time.
  **Do not assume a layer exists for an un-migrated area** — check before wiring into it.
- **Docs:** `docs/architecture/` (the *why* behind each rule), plus
  `docs/security-checklist.md` and `docs/seo-checklist.md` — read those when touching
  auth/headers or public pages respectively.

## Commands

- `npm run dev` · `npm run build` · `npm run lint`
- `npm test` — `vitest run` (**the checkpoint gate**) · `npm run test:watch`
- `npm run depcruise` — dependency-cruiser boundary check
- `npm run threads:crawl-images` / `threads:build-map-AFTER-CRAWL` — embroidery thread map
  (run in that order; the second reads the first's output)

## Site content rules

These three are **specific to this project** and are easy to miss because nothing fails
loudly when they're skipped.

### Sitemap dates

Static-page `lastModified` timestamps live in `src/lib/sitemap-dates.ts`. Whenever a
static page under `src/app/` is edited (`/about`, `/projects`, `/blog`, `/resume`,
`/contact`, `/privacy`, or `/`), update that page's entry in `STATIC_ROUTE_DATES` to the
current date/time.

### Project / work sync

Projects live in `src/content/projects/*.json`, one file per project. The home page
(`getFeaturedProjects()`) and the work page (`getAllProjects()`) both render from that
source, so a JSON edit flows to both. **The home page is a hard cap of 4**, controlled by
`featured: true` plus `order`.

- **Adding a project:** create its JSON. If it belongs in the top 4, set `featured: true`
  and an `order` that slots it correctly — and demote a current featured project in the
  same change. **Never leave 5 featured.**
- **Retiring a project:** delete the JSON; if it was featured, promote the next most
  important so the home page still shows 4.
- **Reordering:** adjust `order` on the featured entries. Lower renders first.
- **Editing copy/stack/URLs:** the JSON is the single source — but verify both pages.

### README sync

`README.md` doubles as the GitHub profile README for `jawetzel/Jawetzel`. Check whether
it needs a matching update whenever any of these change:

- `src/content/projects/*.json` — names, taglines, URLs, stacks, or the featured list
- `src/app/about/page.tsx` — day-job narrative, employer names, location, years of experience
- `src/app/page.tsx` — top-level tagline or the availability signal
- `src/app/security-audit/page.tsx` — if the case study is un-redacted or the link moves

Keep the README's voice consistent with the site — same taglines, em-dashes fine, no
badge clutter.

## Skills — the reusable chunks

`.claude/skills/` holds project-agnostic procedures. Each is standalone and can be
swapped or dropped on its own; this file supplies the project-specific facts they look
up at runtime.

| Skill | Use |
|---|---|
| `git-summary` | Summarize the working diff; write a commit subject + body. Read-only git. |
| `changelog-protocol` | Content rules for a changelog entry — the *layout* here is `src/content/changelog.json`, not day files. |
| `documentation-protocol` | Sync `README.md`, `docs/`, and `sitemap-dates.ts` with shipped behavior. |
| `testing-protocol` | Decide what a change needs, where tests go, and enforce the green gate. |
| `ux-heuristics` | Usability bar for any view or flow — Krug, Nielsen's 10, severity ratings, dark patterns, WCAG. |

### UX

**The principles are always in force** — `.claude/rules/ux.md` is imported at the top of
this file and governs every view and flow as it's written. It is not an optional pass.
The goal is **minimizing the effort a task costs the user**: fewer decisions, fewer
words, fewer chances to get it wrong — explicitly *not* the same as fewer clicks.

**Invoke the `ux-heuristics` skill to *evaluate*** — a heuristic audit, severity ratings,
a 10/10 score with the specific fixes to get there, or the deep references (WCAG, dark
patterns, cultural UX, resolving heuristic conflicts). Rules govern building; the skill
governs judging. **Audit every tool before it ships** — see why below.

This site has a sharper version of the problem than most:

- **The tools are the portfolio.** A visitor who can't work out how to use the embroidery
  pipeline or the vectorizer doesn't conclude the tool is confusing — they conclude the
  author builds confusing software. Usability *is* the credential being demonstrated.
- **No onboarding, no second visit.** Every tool user is a first-time user arriving cold,
  usually from a link. It has to be self-evident on the first screen, with no
  instructions to read.
- **The trunk test is load-bearing** — traffic lands deep (a project page, the security
  audit case study) rather than on the home page.

`docs/seo-checklist.md` and `docs/security-checklist.md` cover the other two axes of a
public page; this covers whether a human can actually use it.

## Workflow

### Living documents

- **`todo.md`** — saved tasks. Only worked when the user explicitly asks. Never written
  to without permission.
- **`src/content/changelog.json`** — the changelog. **This project does not use markdown
  day files**; entries back a public changelog page, so they must read well in isolation.
  See the `write it up` step 3 below.
- **`README.md`** — see README sync above.
- **`plan.md`**, **`seo.md`**, **`offer.md`** — strategy and roadmap. Decisions recorded
  there are *approach fixed, implementation possibly design-later*. **Do not implement
  anything that lives only in `plan.md`/`todo.md`.**

### Session protocol

1. **Start:** the user drives the session. Don't assume `todo.md` is the agenda.
2. **During:** build what's asked; follow the imported rules above.
3. **End:** the user says "write it up" — run the protocol below — or commits manually.

### `write it up`

When the user says **"write it up"** (or "write that up" / "write up"), run this
protocol. It is the *orchestration* — each step delegates to a skill in
`.claude/skills/`, which holds the detail. Run the steps in order.

| # | Step | Skill |
|---|---|---|
| 1 | **Survey the changes.** Read the **full** diff — `git status`, `git diff HEAD`, and untracked files via `git ls-files --others --exclude-standard`. The tree may hold work from prior sessions or done outside chat; the write-up covers **everything in the diff**, not just what was discussed. If something lacks obvious context, **ask before writing it up**. | `git-summary` |
| 2 | **Changelog.** Append to `src/content/changelog.json` — see the entry shape below. | `changelog-protocol` (content rules only — the layout is this project's) |
| 3 | **Documentation.** Sync `README.md` per the sync rule above, `docs/`, and `src/lib/sitemap-dates.ts` if a static page changed. | `documentation-protocol` |
| 4 | **Tests.** Cover the logical changes per the layer table in `.claude/rules/testing.md`. | `testing-protocol` |
| 5 | **Gate.** `npm test` green, `npx tsc --noEmit` clean, `npm run depcruise` clean. **If anything fails, stop and report — do not produce a commit message.** | — |
| 6 | **Commit message.** Subject ≤ 72 chars, imperative. Body wrapped at ~72, naming the distinct buckets if the diff is mixed. Print it in a fenced code block so it's copyable. | `git-summary` |
| 7 | **Report.** Changelog entry, docs touched, test results, the commit message, anything needing attention. | — |

#### Changelog entry shape

`src/content/changelog.json` is an array of `{ date, title, description }`, **newest at
the top**:

- `date` — ISO `YYYY-MM-DD`, the day it shipped
- `title` — short human headline, ≤ 70 chars
- `description` — what changed and **why it matters to a visitor**. If the diff spans
  unrelated work, either group it or write multiple entries.

Voice matches the rest of the site: no marketing fluff, lead with user-facing impact,
em-dashes fine. These entries back a public page — they must stand alone without the diff.

#### Rules

- **Additive only.** This protocol appends a changelog entry, syncs docs, and writes
  tests. **It never touches `todo.md`** or any other steering file — if a checkpoint
  closes something tracked there, say so in the report and leave the file alone.
- **No git actions, ever.** `status`, `diff`, `log`, `ls-files` are read-only and
  expected; `add`, `commit`, `push` are the user's.
- **A failing test blocks the checkpoint.** Never skip, delete, or weaken a test to
  reach green.

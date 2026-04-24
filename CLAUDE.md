@AGENTS.md

## Sitemap dates

Static-page `lastModified` timestamps live in `src/lib/sitemap-dates.ts`. Whenever a static page under `src/app/` is edited (e.g. `/about`, `/projects`, `/blog`, `/resume`, `/contact`, `/privacy`, or the root `/`), update that page's entry in `STATIC_ROUTE_DATES` to the current date/time.

## Project/work sync

Projects live in `src/content/projects/*.json` (one file per project). Both the home page (`src/app/page.tsx`, via `getFeaturedProjects()`) and the work page (`src/app/projects/page.tsx`, via `getAllProjects()`) render from the same source, so edits to a JSON flow to both automatically. But the home page is a **hard cap of 4** — the four most important works — and is controlled by the `featured: true` flag plus the `order` field. When changing work:

- **Adding a new project:** create its JSON. If it belongs in the top 4, set `featured: true` and give it an `order` that slots it correctly. If there are already 4 featured projects and the new one is more important, demote a current featured project (`featured: false`) at the same time — never leave 5 featured.
- **Removing/retiring a project:** delete the JSON. If it was featured, promote the next-most-important project (`featured: true`) so the home page still shows 4.
- **Reordering the top 4:** adjust the `order` field on the featured entries. Lower `order` renders first.
- **Editing a project's copy, stack, or URLs:** the JSON is the single source — no per-page duplication, but verify both pages still look right.
- Don't forget the README sync rule below — the README lists the same featured 4 and needs the matching update.

## README sync

`README.md` doubles as the GitHub profile README for `jawetzel/Jawetzel` — it mirrors content sourced from the site. Whenever any of the following change, check whether `README.md` needs the matching update:

- `src/content/projects/*.json` — project names, taglines, URLs, stacks, or featured list
- `src/app/about/page.tsx` — day-job narrative, employer names, location, years-of-experience
- `src/app/page.tsx` — top-level tagline or the availability signal ("Taking on one new engagement this quarter")
- `src/app/security-audit/page.tsx` — if the case study is un-redacted or the link moves
- A new featured project is added, or an existing one is removed/retired

Keep the README's voice and structure consistent with the portfolio — same taglines, same em-dashes, no badge clutter.

# Data & content

> Target framing. Behavior is unchanged — see [`overview.md`](overview.md) for
> status. This describes how content and data flow today and the port boundary
> the refactor draws around them.

There are two distinct data worlds, and keeping them distinct is the point:

1. **Editorial content** — projects, blog posts, testimonials, marquee, resume,
   changelog. **File-sourced**, read-only at runtime, version-controlled. No
   database. Editing is a content commit, not a code change.
2. **Application data** — users, embroidery generations, API-key hashes, chat
   conversations. **MongoDB**, mutable, request-driven. Covered in
   [`external-services.md`](external-services.md) and [`auth.md`](auth.md); this
   doc is mostly about world #1.

## Editorial content — the source files

| Content | Source | Shape owner (today) |
| --- | --- | --- |
| Projects / case studies | `src/content/projects/*.json` (one file per project) | `ProjectCaseStudy` in `src/lib/projects.ts` |
| Blog posts | `blog/*.json` (named `YYYY-MM-DD-slug.json`, repo root) | `BlogPost` in `src/lib/blog.ts` |
| Testimonials | `src/content/testimonials.json` | `src/lib/testimonials.ts` |
| Marquee | `src/content/marquee.json` | `src/lib/marquee.ts` |
| Resume | `src/content/resume.json` | `src/lib/resume.ts` |
| Changelog | `src/content/changelog.json` | written by the **"write it up"** flow |

A project JSON is the full case study — `slug`, `name`, `tagline`, `stack[]`,
`highlights[]`, `featured`, `order`, `status`, `problem`, `actions[]`,
`outcome`, `underTheHood`, `links[]`, `screenshots[]`. A blog JSON carries
`title`, `description`, `tags[]`, `kind` (`article|video|both`), `bodyMd`, and
optional `hero`/`youtubeId`/`videoMeta`.

## The getter pattern (current read boundary)

Each content type has a `src/lib/<type>.ts` module that owns the TypeScript
shape and reads the files synchronously at the Node FS layer:

```ts
// src/lib/projects.ts — representative
const PROJECTS_DIR = path.join(process.cwd(), "src", "content", "projects");

export function getAllProjects(): ProjectCaseStudy[] { /* readdir → JSON.parse → sort by order */ }
export function getProjectBySlug(slug): ProjectCaseStudy | null { /* find */ }
export function getFeaturedProjects(): ProjectCaseStudy[] { /* filter featured */ }
```

`blog.ts` does the same with a module-level `cache` and a filename → date/slug
convention; `getAllPosts()` sorts newest-first and ignores `_`/`.`-prefixed
files. **This getter idiom — typed shape + FS read + in-memory shaping in one
file — is exactly the seam the refactor splits.**

### Single-source rule (already enforced)

Both the home page (`getFeaturedProjects()`) and `/projects`
(`getAllProjects()`) render from the same JSON — there is no per-page
duplication. The home page is a **hard cap of 4**, driven by `featured: true` +
`order`. This is a real product invariant and is documented in `CLAUDE.md`
under **Project/work sync**; the refactor must preserve it.

## Target: a `ContentSource` port

The getter does two jobs that belong in two layers:

- **Adapter (`infrastructure/`):** "given a content kind, hand me the raw
  records from the filesystem." A `FsJsonContentSource implements ContentSource`.
- **Use-case (`application/`):** "give me the featured projects, capped and
  ordered" / "give me posts by tag." Sorting, filtering, the cap-of-4, the
  newest-first ordering — these are application rules, tested against an
  `InMemoryContentSource` fake with no disk involved.
- **Domain (`domain/`):** `ProjectCaseStudy`, `BlogPost`, `PostKind` as types/
  value objects.

Payoff against the four goals: the cap-of-4 and tag-counting logic become
**unit-testable without the filesystem** (testability); the FS dependency is
**inverted** behind a port (a future CMS or DB-backed source is a drop-in
adapter); and the "what content rules apply" concern is **separated** from the
"where bytes come from" concern.

### List vs single-item reads

Card grids (`/projects`, the home featured strip, the blog index) only need a
projection — name, tagline, stack, status, slug. Detail pages
(`/projects/[slug]`, `/blog/[slug]`) need the full record. The target draws the
same single-item-vs-list distinction as the reference model: list reads return
sparse projection DTOs; detail reads return the full entity. Today everything
reads the full JSON; for this app's content sizes that's fine, so this is a
*shape* convention to honor in new code, not a performance fix to chase.

## `src/data/` is not content

`src/data/` (thread color maps, crossmatch tables) is **dev scratch / build
output**, not editorial content and not prod runtime data — it is even in
`.dockerignore`. Don't model it as a `ContentSource`. Runtime thread/palette
data the tools actually serve lives in R2 (the compiled supply feeds) and in the
embroidery `inkstitch/palettes/*.gpl` files. See the memory note on `/data`
scope.

## Sitemap dates

Static-page `lastModified` timestamps live in `src/lib/sitemap-dates.ts`
(`STATIC_ROUTE_DATES`). This is a hand-maintained map, updated whenever a static
page changes — a `CLAUDE.md` rule, not an automated derivation. In the target it
is a small pure module the SEO use-case reads; it does not need a port.

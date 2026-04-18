# Portfolio Website — Plan

## Goal
A freelance / consulting site that gives potential clients and employers everything they need to evaluate and contact Joshua: who he is, what he's built, how to reach him, and what he's thinking about.

## Parked — engagement model (needs more discussion)
**Status:** parked 2026-04-17. Joshua has no consulting experience yet and wants to keep talking this through before locking in.

**Working direction (not committed):** two-rung ladder
1. **Paid audit / assessment** — productized, fixed price (~$2–4K, 1 week). Written report: risks, quick wins, modernization roadmap. Low-commitment onramp that qualifies the client and pays for discovery.
2. **Weekly retainer build** — $X/week, 2–8 week engagements. Graduate from successful audits. Weekly beats hourly (no click-counting; easier to say no to scope creep).

**Intentionally avoided for v1:**
- Hourly — caps upside, invites micromanagement
- Fixed-price full builds — scope creep will eat a first-time consultant alive

**Public-facing posture for v1:** no rates on the site. "Let's talk about your project" → contact form → price each inquiry individually. Revisit publishing rates after 2–3 closed engagements.

**Still to discuss:**
- Is this even the right business model, or is the site more "hire-me-full-time" focused?
- If consulting: what services specifically — legacy modernization? greenfield SaaS builds? AI-assisted ops tooling? mobile apps? Pick 1–2 to lead with.
- How much of the engagement model is visible on the site vs. handled in conversation after the inquiry?
- Do we want a lightweight "how I work" page eventually, or keep it conversational?

## Stack
- **Framework:** Next.js (App Router, TypeScript)
- **Styling:** Tailwind CSS v4
- **Components:** shadcn/ui
- **Content store:** Hardcoded JSON in the repo. Blog posts live in `blog/YYYY-MM-DD.json`, projects in `src/content/projects/*.json`, testimonials in `src/content/testimonials.json`. Git is the content history.
- **Database:** None. Fully static + filesystem.
- **Content model:** Read-only app. No admin UI, no auth, no login. New content ships via git commits.
- **Writes the app does make:** just the contact form → Brevo email. No DB row. If Brevo fails, the inquiry is lost (accepted tradeoff — mitigated by form-side retry on send failure).
- **Media:** YouTube embeds for video. Image hosting — TBD (placeholder images while we build; R2 or similar figured out later).
- **Deployment:** TBD (user handles)

## Design direction
**Playful.** Not leaning "playful-professional" or "playful-personal" — just playful. Pick the vibe that reads most Joshua, not one pre-filtered for consulting audiences.

- Personality in the typography (display font + clean body pairing)
- Motion where it earns its keep (hover states, page transitions, scroll reveals — not everywhere)
- Bold accent color, willingness to break the grid occasionally
- Easter eggs / small delights are welcome
- Still fast, still accessible, still readable on a phone in sunlight

**Palette anchor (locked):** `#55D6D0` — bright cyan/teal. Used as an accent, not body text (contrast on white ~1.9:1 fails WCAG AA, so it goes on buttons / UI accents / graphics / focus rings / large-text section backgrounds with dark text).

**Still to pick:**
- Primary text + heading color (candidate: deep navy `#0A1B2E` — high contrast with cyan, grounds the brightness)
- Surface / background (candidate: off-white or warm cream; pure white makes cyan feel sterile)
- One secondary accent for tension — a warm color (coral, amber, or sunny yellow) keeps the palette from reading as "generic cool tech"
- Display + body type pairing

Mood references — TBD during design pass.

## Information architecture

```
/                 Home — hook, elevator pitch, featured work, CTA
/about            Long-form bio, philosophy, what I do / don't do
/projects         Project index (cards)
/projects/[slug]  Case study per project
/blog             Blog index (mixed posts + videos, filterable)
/blog/[slug]      Blog post / video detail (MongoDB-backed, read-only)
/resume           Resume (viewable + downloadable PDF)
/contact          Contact form + direct links (email, LinkedIn, GitHub)
/privacy          Basic privacy page (no cookies, no tracking)
```

Global: sticky/animated nav, footer with socials + copyright.

## Pages — what each needs

### Home
- Hero: name, one-line pitch, primary CTA (hire me / see work)
- Featured projects (2–3)
- Snippet from latest blog post
- Secondary CTA to contact

### About
- Narrative bio (not a resume dump) — **copy TBD during implementation**, not pre-written here
- How I work / what I'm good at / what I decline
- Avatar — **placeholder for v1** (stylized glyph / initials / illustrated silhouette). Real photo later.

### Projects
**Framing:** each case study leads with *what got tackled and what problems it solved* — not a stack parade. Stack chips belong in the margin; the narrative is about the work.

Per-project structure:
1. **The problem** — what existed before, what was broken or missing, who felt the pain
2. **What I did** — the concrete thing(s) I tackled (2–4 beats, not a feature list)
3. **How it solved it** — the outcome, even if qualitative ("gave vendors a way to reconcile sales without paper books")
4. **Under the hood** — short stack + any interesting engineering calls, as a secondary layer

Index page: card per project with logo, one-line problem-framed hook, stack chips.
Detail page: follows the structure above. Screenshots as visual proof (placeholders in v1 until real ones are picked).

The Weekend Plant / CookJunkie / TutorTab / Vorbiz case study notes below are raw source material — they need to be *reframed* into the "problem → what I did → outcome" shape, not published as-is.

### Blog
**Hardcoded JSON files in a `blog/` folder at the repo root.** No database. Mixed media — articles, YouTube videos, or both.

**File naming:** `blog/YYYY-MM-DD.json`. Date (no time) is the filename. The date is also the publish date; filesystem presence = published.
- If more than one post lands on the same day: `blog/YYYY-MM-DD-a.json`, `-b.json`, etc.
- Slug derived from filename (date + optional suffix), or overridden by a `slug` field in the JSON.

**Post shape:**
- `title`, `description`, `tags[]`
- `kind`: `article` | `video` | `both`
- `bodyMd` — markdown body (rendered server-side with syntax highlight)
- `hero` — image URL, optional
- `youtubeId` — YouTube video ID when `kind` is `video` or `both`
- `videoMeta` — `{ duration, publishedAtOnYt }`, optional (manually filled)
- `slug` — optional override; defaults to filename

**How the app reads posts:**
- At build time (or on request): `fs.readdir('blog/')` → parse each JSON → sort by filename descending → expose as the post list
- No "draft" state — if you don't want it live, don't commit the file (or keep it in a `blog/_drafts/` subfolder the reader ignores)

**Index page:**
- Reverse-chronological, filterable by `kind` (All / Articles / Videos) and by tag
- Card shows thumbnail (YT thumb for videos, hero image for articles), title, description, reading time or duration, tags
- Pagination

**Detail page:**
- Articles: rendered markdown, code blocks with syntax highlight, table of contents for long posts, prev/next nav
- Videos: embedded YouTube player at top, show notes / chapter links below
- Both: embed first, then article body — "here's the video, here's the writeup"

**SEO:**
- Dynamic OG images per post (YT thumbnail overlay for video posts)
- RSS feed (articles + videos, with `<enclosure>` for video posts)
- VideoObject JSON-LD on video pages
- Sitemap includes all published posts

**Authoring workflow:** create a new JSON file in `blog/`, commit, deploy. Git is the content history.

### Privacy
Basic static page at `/privacy`. The posture is simple because the site is simple: no cookies, no tracking pixels, no analytics, no accounts, no third-party embeds that drop cookies (YouTube embeds use `youtube-nocookie.com` variant).

Contents:
- What we collect: only what you submit via the contact form (name, email, message). Used once to reply to you, then it lives in Joshua's email inbox.
- What we don't: no cookies set by the site, no analytics, no ad networks, no fingerprinting, no third-party trackers.
- Third parties involved: Brevo (email delivery) and YouTube (video embeds via the no-cookie domain). Links to their privacy pages for anyone who wants to dig further.
- Contact: how to reach Joshua to have your submitted info deleted.

Footer links to `/privacy` on every page. No cookie banner needed (because: no cookies).

### Testimonials
- **v1: hardcoded JSON** at `src/content/testimonials.json`. One placeholder entry to start (`"Placeholder — real quotes coming soon"` is fine; or a generic stand-in). Real ones slot in later.
- Shape: `{ quote, name, role, company, avatarUrl? }[]`
- Rendered on Home (as a row/carousel) and optionally on `/about`
- No admin UI — Joshua edits the JSON file when real testimonials arrive

### Resume
- On-page rendered version (SEO-friendly, accessible)
- Download PDF button
- Kept in sync with a single source (JSON in repo → both renders)

### Contact
Contact form *is* the booking mechanism — no Cal.com, no calendaring widget. Goal: qualified inbound emails that Joshua responds to personally.

**Form fields:**
- Name, email, message (required)
- Optional: project type (dropdown), budget range, timeline
- Honeypot + rate limit (reuse `withRateLimit` from the shared libs)

**On submit:**
- Validate + sanitize (reuse `escapeHtml` / `sanitizeInput` patterns)
- Send notification email to Joshua via Brevo
- Send auto-response to the submitter (confirms receipt, sets response expectation)
- If Brevo send fails: surface a clear error in the UI with a fallback mailto link, so the submitter isn't silently dropped

**Email plumbing — stripped-down port from CookJunkie:**
- `src/lib/email.ts` — just Brevo `sendEmail({ to, subject, html })`. No E2E log-to-DB mode, no suppression list (both required a DB). Brevo handles bounces/complaints at their end; volume here is low enough that we don't need our own list.
- Env vars needed: `BREVO_API_KEY`, `EMAIL_FROM` (e.g. `mailer@jawetzel.com`), `APP_URL` (e.g. `https://jawetzel.com`)
- Templates: one for the "new inquiry" notification to Joshua, one for the auto-response. Keep HTML minimal.

**Fallback:** direct email + LinkedIn + GitHub always visible on the Contact page in case the form is broken or the submitter prefers direct contact.

## Build phases

### Phase 1 — Scaffold
- `create-next-app` w/ TS + Tailwind + App Router
- `shadcn init`, add base components (button, card, input, textarea, badge, sheet)
- Global layout: nav, footer, theming (light/dark), font loading
- Basic routing for all pages above (placeholder content)

### Phase 2 — Content loaders + contact form
No admin UI. No auth. No image pipeline. The only write path the app owns is the contact form.

**Content loaders (all filesystem-based):**
- `src/lib/blog.ts` — reads `blog/*.json`, parses each, sorts by filename desc, exposes `getAllPosts()`, `getPostBySlug()`, `getPostsByTag()`, `getPostsByKind()`. Memoized in-process.
- `src/lib/projects.ts` — reads `src/content/projects/*.json`, exposes `getAllProjects()`, `getProjectBySlug()`.
- `src/lib/testimonials.ts` — reads `src/content/testimonials.json`.
- `src/lib/resume.ts` — reads `src/content/resume.json`.

**Ports from other projects (trimmed to what a DB-less contact form actually needs):**
- From **CookJunkie**: `email.ts` — stripped of E2E log-to-DB mode and suppression gate. Pure Brevo `sendEmail`.
- From **Weekend Plant**: `api-helpers.ts` (`withRateLimit`, `apiError`/`apiSuccess`), `rate-limit.ts` (in-memory sliding window — fine for low-volume contact form on a single instance)
- *Not porting:* `auth.ts`, `image.ts`, `r2.ts`, `db.ts`, `crud.ts`, `withAdminAuth`, `email-suppression.ts`

**Contact form endpoint:**
- POST `/api/contact` — honeypot check → rate limit → validate → send Brevo email to Joshua + auto-response → return success
- On send failure: return a clear error so the UI can show the mailto fallback

**Seed content:** start with 1–2 sample blog posts (`blog/2026-04-17-hello-world.json`), 4 project JSONs (placeholder copy using the case-study notes below), 1 placeholder testimonial, resume JSON from the existing resume data.

**Authoring workflow (documented in README):** write a JSON file → commit → deploy.

### Phase 3 — Design pass
- Lock typography, color, spacing scale
- Build home hero + one polished project case study as the "north star" look
- Cascade that style to other pages

### Phase 4 — Playful layer
- Motion: page transitions, hover affordances, scroll-linked moments
- Micro-interactions on nav / CTAs
- One or two easter eggs
- Keep perf budget honest (LCP, CLS, bundle size)

### Phase 5 — Ship polish
- SEO: metadata, OG images (per-post dynamic), sitemap, robots
- Contact form wiring + spam guard (rate limit + honeypot + Origin/Referer check — no CSRF cookie needed)
- Privacy page copy
- YouTube embeds switched to `youtube-nocookie.com` variant
- Accessibility pass (keyboard, contrast, reduced-motion)
- Lighthouse / perf sweep

## Content inventory (from `../new_job`)

### Source files (mined for content only — ignore their styling)
- `C:/Repo/new_job/JoshuaWetzelResume.html` — resume text/structure
- `C:/Repo/new_job/joshua_wetzel_meta.md` — long-form bio source / differentiators / talking points (used as *raw input* during implementation; final bio copy TBD)
- `C:/Repo/new_job/assets/logos/` — project logos (cookjunkie, weekendplant, vorbiz, tutortab)

### Identity
- **Name:** Joshua Wetzel
- **Domain:** jawetzel.com
- **Location:** Greater Baton Rouge, LA (Prairieville 70769)
- **Email:** jawetzel615@gmail.com · **Phone:** 225-305-9321
- **LinkedIn:** linkedin.com/in/joshua-wetzel-97a714130
- **GitHub:** github.com/jawetzel
- **Pitch:** Full-stack developer, 6+ yrs, .NET Core / Node / React / Angular / SQL / MongoDB. Modernizes legacy systems. AI-tool-native. Remote-proven.

### Experience
- **Tri-Core Technologies** — Software Developer, Oct 2021 – Present (Remote). Sole dev on Fastlane compliance platform.
- **Lipsey's LLC** — Software Developer, Dec 2019 – Oct 2021. Modernized VB → .NET Core + React; AWS infra.
- **Not Rocket Science Inc.** — Web Dev Intern, Jan 2017 – Apr 2018. NLP prototyping (Watson, LUIS, Alexa).

### Projects (featured on the site — 4 total, Kindlr dropped)
1. **CookJunkie** — cookjunkie.com · see case study detail below
2. **Weekend Plant** — weekendplant.com · see case study detail below
3. **Vorbiz** — vorbiz.net · see case study detail below
4. **TutorTab** — tutortab.net · see case study detail below

#### CookJunkie — case study source (`../cookjunkie`)
**What it is:** High-traffic recipe site migrated off WordPress onto a modern Next.js stack. Live at cookjunkie.com. ~8,600 recipes served from MongoDB, plus a cookbook print-on-demand product layered on top.

**Stack:** Next.js 16 (App Router, SSR) · React · TypeScript · Tailwind v4 · shadcn/ui · MongoDB Atlas · Stripe · Cloudflare R2 · Lulu Print API · Brevo · Sentry · `@react-pdf/renderer` · Sharp

**Angles worth leading with in the write-up:**
- **WordPress → Next.js migration at scale.** Scraped ~8,600 recipes + 18 pages into JSON, normalized the shape, seeded MongoDB with upsert-safe indexing. Replaced the full WP rendering path with server-first Next.js.
- **Recipe audit pipeline — AI-in-the-loop at scale.** Batch-audit system that dumps recipes to per-ID source files, splits into batches, then runs Claude on each batch in parallel (10 agents per run) to fix formatting/missing fields/bad instructions. Audit fix files are then applied via `audit:update` with a dry-run mode. Demonstrates building ops tooling around AI agents, not just calling an API.
- **Print-on-demand integration (Lulu + Stripe).** End-to-end flow: user builds a cookbook → PDFs generated (interior + cover) via `@react-pdf/renderer` and uploaded to R2 → anyone with link can order via Stripe Checkout (no account required) → webhook freezes PDFs to `orders/{token}/`, creates Lulu print job, auto-refunds on Lulu failure → public tracking page pulls live status from Lulu API. Includes pricing tiers, cancellation windows, issue reporting.
- **Book locking + race guards.** While an order is in checkout, the book is locked against edits for up to 10 min; frozen PDF snapshots ensure in-flight orders aren't affected by later edits.
- **Admin API with bearer auth.** Machine-readable schema endpoint, multipart book creation, field-projection on recipe lists — designed for external tooling.
- **SEO-first templating.** Taxonomy pages (cuisine / course / diet / ingredient / category) all routed as `/[type]/[slug]/` with trailingSlash for WordPress-era link parity.

**Assets available:**
- Logo: `C:/Repo/new_job/assets/logos/cookjunkie.png`
- Live site for screenshots: cookjunkie.com

#### TutorTab — case study source (`../tutor_billing`)
**What it is:** Pay-as-you-go scheduling, reminders, and invoicing for independent tutors. Live at tutortab.net. Tutors get a booking page, Google Calendar sync, session tracking, automated invoicing; parents get magic-link auth, autopay, receipts. Platform takes 2.5% (capped $1/invoice, $20/month) on top of Stripe fees — tutors keep 100% of session price.

**Stack:** Next.js 16 (App Router, Server Components) · React 19 · TypeScript 5 strict · MongoDB · NextAuth v4 · Stripe Connect Express · Google Calendar API · Tailwind v4 · shadcn/ui · Brevo · Sentry · node-cron · Playwright · Vitest (431 tests, 47 files)

**Angles worth leading with in the write-up:**
- **Full SaaS built end-to-end solo.** 10 build phases — foundation → onboarding → calendar sync → booking → session lifecycle → invoicing → parent account → dashboard → background jobs → hardening. Not a demo; a production SaaS with real payment flows.
- **Stripe Connect Express with sharp edges handled.** Destination charges for tutor payouts, platform-fee caps (per-invoice and per-month), idempotency keys on autopay charges, double-payment prevention (checks existing PaymentIntent before creating a new one), automatic fallback from autopay to manual invoice on failure, refunds with proportional fee reversal, full dispute/chargeback webhook handling with auto-block after 5 lost/pending disputes in 6 months.
- **Two-way Google Calendar sync that doesn't eat itself.** Webhook endpoint + incremental sync via `syncToken`, student-name parsing from event titles, contact extraction, platform-managed event detection, 24h stale-check backstop, webhook renewal failure detection, session reconciliation on reconnect. Sync failures escalate: immediate → 24h → 48h → 7d deactivation.
- **Booking availability engine.** Public booking page at `/{slug}` — availability calculated from tutor windows minus calendar events, blackout dates, and existing sessions. Race-condition guards at confirmation time. Returning-parent detection with pre-fill.
- **11 cron jobs doing real work.** Overdue invoice reminders with 5 escalating tiers (day 1/3/7/14/28), daily tutor overdue summary, weekly + monthly tutor summaries, orphaned fulfillment timeout (48h reminder → 7d auto-complete), pre-session reminders (24h/1h) with dedup via notifications collection.
- **Security & compliance posture.** CSRF via Origin/Referer middleware, input sanitization on all user-facing routes, AES-256-GCM encryption for OAuth refresh tokens at rest (with transparent migration), age gate storing only `isOver18` (never raw DOB), TOS timestamps, immediate data deletion with PII scrub + session anonymization, invoice retention for compliance.
- **Unified auth across two roles.** One NextAuth setup handles tutors *and* parents via Google OAuth + magic links, with role auto-detection and route-level enforcement.

**Assets available:**
- Logo: `C:/Repo/new_job/assets/logos/tutortab.png`
- Screenshots folder: `C:/Repo/tutor_billing/screenshots/`
- Live site for screenshots: tutortab.net

#### Vorbiz — case study source (`../vorbiz` + `../vorbiz-api`)
**What it is:** Native iOS + Android point-of-sale built for market/booth vendors — track sales, manage products and locations, generate sales-tax reports. Shipped on Play Store and App Store; marketing site at vorbiz.net.

**Pitch:** "Forgot your book? I bet you didn't forget your phone." EOD reconciliation, EOY revenue for income tax, EOM sales for sales-tax filing — all from the phone you already have, on or offline.

**Stack:**
- *Mobile:* React Native · Expo (SDK 54) · TypeScript · expo-router · WatermelonDB (offline-first local DB) · react-native-vision-camera (QR scanning) · expo-print (PDF export) · papaparse / react-native-csv (import/export) · react-native-maps · Google Sign-In + expo-auth-session · RevenueCat (subscriptions) · Sentry · Aptabase (analytics) · EAS Build
- *API:* Node.js · Express 5 · Drizzle ORM · PostgreSQL · JWT · Helmet · rate-limiting · Brevo · Google APIs · in-app-purchase + revenuecat (receipt validation)

**Angles worth leading with in the write-up:**
- **Offline-first by design.** WatermelonDB on device; sales are captured locally and sync to Postgres when connectivity returns. Critical for outdoor/rural markets where connectivity is spotty.
- **Multi-device sync with conflict handling.** Records carry `device_id`, `updated_at`, and `deleted_at`. Direct API deletes are hard; sync deletes are soft — so offline edits on a "deleted" record can still be reconciled. Sync only runs online (`syncOnline=false` otherwise).
- **Immutable sales + audit trail.** Prices and taxes are snapshotted at time of sale — never re-computed. Corrections happen via voids or offsetting sales, not edits. This matches how real accounting works and protects the tax-report integrity.
- **Two-tier tax engine.** Client rounds line totals and per-line tax at 2 decimals; server stores rates at 5-decimal precision but performs no computation. Supports tax-included and tax-on-top pricing per location, with resale-cert prioritized over 501(c)(3) exemption logic.
- **Native hardware integrations.** QR-based item entry via Vision Camera; PDF report export via expo-print; CSV import/export; maps for location pins.
- **Monetization plumbing.** RevenueCat entitlements gate advanced features (reporting, exports); server-side validates receipts via `in-app-purchase` and `revenuecat`.
- **Published to both stores.** EAS Build pipeline, auto-submit to iOS, Play Store internal + closed testing tracks wired up.
- **Real documentation discipline.** `BUSINESS_RULES.md` codifies sales, sync, tax, and privacy rules with source-file citations — a useful artifact to show in the case study as "how the product is actually governed."

**Assets available:**
- Logo: `C:/Repo/new_job/assets/logos/vorbiz.png`
- Live marketing site: vorbiz.net
- Store listings: Google Play (com.vorbiz.app), App Store (id6753637365)

**Per-project notes:**
- Screenshots: **placeholders in v1** — real ones slot in later
- Outcome / metric to highlight: figure out per-project during implementation (may or may not exist for each)
- Framing: solo-shipped products (confirmed direction given the consulting positioning)

## Blog + YouTube — open decisions (TBD)
- YouTube channel ID / handle
- YT video metadata (duration, thumbnails) — manually filled in the DB doc, or a one-off script that pulls from YT Data API on demand?
- Video-first vs. article-first on `kind: both` posts
- Comments — assumed no
- Newsletter signup — assumed no unless you push back

#### Weekend Plant — case study source (`../weekendplant`)
**What it is:** Informational gardening site — how-to guides, plant profiles, and plant combinations. Live at weekendplant.com.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · MongoDB · NextAuth · Sharp · Cloudflare R2 · OpenAI · Brevo (email) · Sentry · Vitest · Playwright

**Angles worth leading with in the write-up:**
- **Three-content-type DRY architecture.** How-tos, plants, and combos share ~80% of their patterns (CRUD, list/detail pages, admin forms, AI generation). Built as shared, parameterized code (generic `ContentCard`, `ContentForm` driven by field configs, shared CRUD helpers) — content-type-specific code only where the models genuinely differ.
- **AI-assisted content pipeline.** OpenAI + Google GenAI for drafting content and generating hero images; admin UI with per-type AI generate buttons, rate-limited.
- **Image pipeline.** FormData → Sharp (resize, optimize, HEIC handling) → Cloudflare R2, centralized in a single `image.ts` module. Downstream scripts for bulk source-image upload and auto hero-crop selection.
- **Design-system discipline.** Color palette derived from a single anchor (`#2d6a4f`) via a script that verifies WCAG AA contrast for all 23 text/background pairings. No hex literals anywhere in components — everything flows through Tailwind v4 `@theme inline` tokens.
- **Email infrastructure with teeth.** Brevo integration with bounce tracking and auto-suppression (3 bounces / 30 days) + complaint blacklist.
- **Testing posture.** Unit tests via Vitest for logic modules (CRUD, rate limit, cache, API helpers) with a shared mock-DB factory; Playwright available for e2e.

**Assets available:**
- Logo: `C:/Repo/new_job/assets/logos/weekendplant.png`
- Hero reference: `C:/Repo/weekendplant/hero-pick.jpeg`
- Live site for screenshots: weekendplant.com

### Education
- B.S. Computer Science, Southeastern Louisiana University, 2015 – 2019

### Skills (grouped)
- **Backend:** .NET Core, Node.js, Supabase, Railway, RevenueCat
- **Frontend:** React, React Native, Expo, Next.js, Angular, TypeScript
- **Data:** SQL, PostgreSQL, MongoDB, SQLite
- **Tools:** Git, Twilio, Sentry, Bruno, Linux
- **AI:** Claude Code, OpenAI Codex

## Resume strategy
- Port resume *content* (not styling) into `/content/resume.mdx` (or JSON) as the single source of truth
- Render on-page at `/resume` in the portfolio's own design language
- Offer a PDF download — regenerate from the on-page version so it matches the portfolio look (ignore the existing PDF's styling)

## Open questions (still need user input)
- Color palette / type pairings — any preferences or references?
- Terms of service — needed alongside the privacy page, or skip for v1?

## Non-goals (v1)
- **Database** — fully static + filesystem. No Mongo, no Postgres, nothing.
- **Admin UI / auth / login** — content ships via git commits
- Image upload pipeline, R2 integration (deferred)
- AI-assisted content generation (not needed without an admin UI)
- Comments, user accounts
- i18n
- E-commerce / payments
- Newsletter signup
- Email suppression list (Brevo handles bounces at their end; contact form volume is too low to need our own)
- **Analytics** — no Plausible / Vercel / GA for v1. Added later if ever needed.
- **Cookies** — the site sets none. Keeps the privacy page trivial and skips the cookie-banner UX tax.

## Next step
Scaffold (Phase 1). Bio, screenshots, avatar, and real testimonials all come in as placeholders; real versions slot in during later passes.

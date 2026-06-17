# Joshua Wetzel

Full Stack Software Engineer — [**jawetzel.com**](https://jawetzel.com)

Six-plus years shipping production software — legacy modernization, solo-scope SaaS, and ops tooling wrapped around AI agents.

Greater Baton Rouge, LA · Remote-proven · Taking on one new engagement this quarter

---

## Shipped

### [CookJunkie](https://cookjunkie.com)
WordPress → Next.js migration of a 15,000-recipe site, with AI-repaired legacy data, AI-assisted recipe authoring (read-from-image + inline audit), a social cooking community, and a Stripe + Lulu print-on-demand cookbook business on top.
_Next.js · MongoDB · Stripe · Lulu Print API · Meta Graph API_

### [TutorTab](https://tutortab.net) · [TrainerTab](https://trainertab.net)
A Stripe Connect platform where independent tutors accept their own payments and parents run autopay across every tutor — magic-link sign-in, two-way Google Calendar sync, an automated reminder cascade, and the same engine white-labeled as TrainerTab for personal trainers.
_Next.js · Stripe Connect Express · Google Calendar API · ~430 Vitest + Playwright tests_

### [Vorbiz](https://vorbiz.net) · [App Store](https://apps.apple.com/app/id6753637365) · [Google Play](https://play.google.com/store/apps/details?id=com.vorbiz.app)
Native iOS + Android POS for market vendors. Offline-first multi-device sync, QR-based sale capture, bulk inventory import from CSV or a Google Sheets URL, and the sales-tax + revenue reports vendors hand to their accountant.
_React Native · Expo · WatermelonDB · PostgreSQL · RevenueCat_

### [Weekend Plant](https://weekendplant.com)
Gardening content site: plant data aggregated from disjointed industry sources, AI-filled gaps with human review, deep-research skill guides, an SEO-first publishing pipeline, scheduled FB + Instagram auto-posting.
_Next.js · MongoDB · OpenAI · Google GenAI · Meta Graph API_

### [Jawetzel.com](https://jawetzel.com)
This site, doubling as a host for small live tools — a cross-vendor pricing-and-quantity feed for embroidery supplies, a one-shot raster → colored SVG vectorizer, and an AI image → machine-ready stitches pipeline available as both a browser UI and an HTTP API.
_Next.js · MongoDB · Anthropic API · Cloudflare R2 · Sharp_

Plus a [redacted security audit case study](https://jawetzel.com/security-audit) from prior in-house work.

## Day job

Developer on **Fastlane**, a compliance platform at Tri-Core — end-to-end feature work across API, web, data model, and rollout since late 2021, alongside a development team and project managers. Before that, two years at Lipsey's, incrementally modernizing a large VB codebase onto .NET Core + React without taking the system offline.

## Stack

.NET Core · Node · Next.js · TypeScript · React · MongoDB · PostgreSQL · Stripe · AWS

## About this repo

Source for [jawetzel.com](https://jawetzel.com) — Next.js 16, Tailwind v4, MongoDB. This repo doubles as the profile README GitHub renders at the top of my page.

## Architecture & code navigation

The portfolio is a single Next.js app with file-sourced content (projects, resume — JSON/Markdown, no CMS) and a few stateful tools layered on: the embroidery image → stitches pipeline, the cross-vendor supply feed, and a resume-aware AI chat. Background work runs in two places — an in-process `node-cron` worker for scheduled jobs, and a separate Python microservice for the heavy embroidery compute.

The normative engineering docs live in [`CLAUDE.md`](CLAUDE.md) and the [`docs/architecture/`](docs/architecture/overview.md) tree:

- [overview](docs/architecture/overview.md) — the architectural model and the goals behind it
- [data-and-content](docs/architecture/data-and-content.md) · [auth](docs/architecture/auth.md) · [external-services](docs/architecture/external-services.md) · [worker](docs/architecture/worker.md) · [embroidery](docs/architecture/embroidery.md)
- [migration](docs/architecture/migration.md) — the planned, behavior-preserving move from the current layout to the target

> **Note:** those docs describe a **target** architecture — a decided direction for a future, behavior-preserving refactor toward stronger testability, layer separation, and dependency inversion. The shipped code works today and is organized more simply; the docs are where it's headed, not where it is.

- **[`AGENTS.md`](AGENTS.md)** — this Next.js version has breaking changes; read `node_modules/next/dist/docs/` before writing code.

## Contact

[jawetzel.com/contact](https://jawetzel.com/contact) · [resume](https://jawetzel.com/resume) · [projects](https://jawetzel.com/projects)

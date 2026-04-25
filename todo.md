# PortfolioWebsite — Selling-Point Gaps

Audit against `C:\Repo\service_docs\` catalog. Already covered: OAuth, encryption, sitemap, in-page SEO, AI chat with tool calls, AI assisted workflows (embroidery pipeline), bot-blocking, rate-limiting, data aggregation, secure files, emails, OpenAPI docs.

Below: catalog topics PortfolioWebsite *doesn't* currently demonstrate.

---

## High value — table stakes for what you sell

### 1. Security headers
Hard to pitch security/compliance work without these.

- [ ] Add CSP to `next.config.ts` `headers()` — start strict (`default-src 'self'`), allow only the third-party origins actually used (Cloudflare Insights, GA if any, R2 image host). Use nonces for inline scripts; avoid `unsafe-inline` in `script-src`.
- [ ] Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` once HTTPS is confirmed everywhere.
- [ ] Add `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- [ ] Resolve any conflict between `X-Frame-Options` and CSP `frame-ancestors` — pick one (prefer `frame-ancestors`).
- [ ] Verify with [securityheaders.com](https://securityheaders.com); aim for A grade.
- [ ] Add `Cache-Control: no-store` on authenticated endpoints (`/api/me`, account/admin pages).
- [ ] Reference: `C:\Repo\service_docs\security\security-headers.md`.

### 2. Unit tests (Vitest + regression-capture pattern)
No visible test suite. Hard to sell methodology without a worked example.

- [ ] Add Vitest. Config at root with `globals: true`, `@` alias to `src/`, pattern `tests/unit/**/*.test.ts`.
- [ ] Mirror layout: `tests/unit/lib/*` ↔ `src/lib/*`, `tests/unit/utils/*` ↔ `src/utils/*`.
- [ ] First targets (high regression value):
  - [ ] `src/lib/rate-limit.ts` — sliding-window math, IP extraction, E2E bypass behavior.
  - [ ] `src/lib/api-auth.ts` — three-path auth resolver (session / API key / shared env key) — pin current behavior per branch.
  - [ ] `src/lib/r2.ts` — `generatePresignedDownloadUrl` URL shape + TTL.
  - [ ] `src/proxy.ts` — UA classification (allowlist hit, blocklist hit, JS challenge mint), HMAC token validity grace window.
  - [ ] Any embroidery business rule (color-distance match, hoop-size enum, quota math) — these are exactly the kind of pure helpers regression-capture tests exist for.
- [ ] Mock at the driver level: spy on Mongo collection methods, no real DB.
- [ ] Add a `tests/unit_plan.md` checklist tracking what's covered.
- [ ] Reference: `C:\Repo\service_docs\testing\unit-tests.md`.

### 3. E2E tests (Playwright + email-to-DB + mocked externals)
Same selling-point logic as unit tests, plus the mock-injection pattern is itself a portfolio piece.

- [ ] Add Playwright. Config: 2 projects (desktop + mobile Chromium), retries on failure, `extraHTTPHeaders` injecting `x-e2e-key` from env.
- [ ] Add a single E2E flag (`SECRET_KEY` + `x-e2e-key` header). All test entry points check `NODE_ENV !== "production" && header === SECRET_KEY`.
- [ ] Email-via-DB: write all sends to an `emailLog` collection always; in E2E mode skip the real Brevo call.
- [ ] Test-only API routes under `/api/test/*` — `login-as`, `emails` (list/clear), `run-job`.
- [ ] Conditional Stripe / external-service mocks at module load (when env var unset, export hardcoded-success mock).
- [ ] Global health fixture: fail any test on console errors, page crashes, 500s, blank bodies.
- [ ] First flows to cover: contact form, AI Chef chat one-shot, embroidery upload happy path, embroidery quota-exceeded path, OpenAPI docs page renders.
- [ ] Reference: `C:\Repo\service_docs\testing\e2e-tests.md`.

### 4. Stripe payments demo
Implemented in cookjunkie + tutor_billing, not visible in portfolio.

- [ ] Pick a small surface — "buy me a coffee," donate, paid-tier upgrade for embroidery API quota.
- [ ] Stripe Checkout Session for direct accept (no Connect needed for a self-payment).
- [ ] Pre-create local order record before redirect.
- [ ] Webhook at `/api/webhooks/stripe` verifying raw body signature; subscribe to `checkout.session.completed` + `charge.refunded` + `charge.dispute.*`.
- [ ] Idempotent fulfillment in webhook (check current order state before transitioning).
- [ ] Don't forget: order success page that polls by token, not the redirect carrying state.
- [ ] Reference: `C:\Repo\service_docs\integrations\stripe-payments.md`.

---

## Medium value — pairs well with existing features

### 5. Magic-link auth
Pairs with the existing Google OAuth.

- [ ] Stateful random token (preferred) or HMAC-signed (no DB write). 32-byte CSPRNG, 30-min expiry, single-use.
- [ ] `POST /api/auth/magic-link` — rate-limited (3/IP/5min), always returns success shape (no enumeration).
- [ ] Email link: `https://jawetzel.com/auth/verify?token=...&callbackUrl=...`. Brevo send.
- [ ] `/auth/verify` page validates + signs in.
- [ ] Set `Referrer-Policy: no-referrer` on the verify page so the token doesn't leak.
- [ ] Reference: `C:\Repo\service_docs\authentication\magic-links.md`.

### 6. IndexNow
Cheap addition given the existing sitemap.

- [ ] Generate a 32-char hex key. Host at `/<key>.txt` (key string as body).
- [ ] On content publish/update, POST `{ host, key, keyLocation, urlList }` to `https://api.indexnow.org/indexnow`.
- [ ] Pick a model: hybrid (immediate ping on publish + nightly sweep for misses). Fail-soft.
- [ ] Persist `lastIndexNowPing` per record so the sweep only re-pings changed content.
- [ ] Reference: `C:\Repo\service_docs\seo\indexnow.md`.

### 7. Social-media auto-post
README mentions it (weekendplant) but PortfolioWebsite itself doesn't demo.

- [ ] Pick one platform first (Facebook Page is simplest — text + image posts via `/{pageId}/photos`).
- [ ] Long-lived Page token via Graph API Explorer → user OAuth → exchange for non-expiring Page token.
- [ ] Admin button "Share on Facebook" on each blog post.
- [ ] Persist returned `post_id` on the post for analytics / deletion later.
- [ ] If Instagram: 2-step container/publish, image must be public HTTPS URL.
- [ ] Reference: `C:\Repo\service_docs\integrations\social-media.md`.

### 8. Changelog
Encode the convention as a portfolio piece, not just a habit.

- [ ] Add `changelog.md` at the root with reverse-chronological dated entries.
- [ ] Add a "Write It Up" section to `CLAUDE.md` instructing the agent to append entries (with `Why:` clauses) at the end of every session.
- [ ] Backfill the most recent ~5 sessions of work as initial entries so the file isn't empty.
- [ ] Reference: `C:\Repo\service_docs\documentation\changelog.md`.

---

## Catalog gaps from sales review (SMB-pitch perspective)

These came out of thinking about what local-business owners actually pay for. Each one needs a catalog topic written; some also benefit from a PortfolioWebsite demo.

### 9. Booking / scheduling
Highly sellable to dentists, salons, contractors, gyms, tutors. Fully covered in `tutor_billing` (availability windows, booking flow, reminders, cancellation policy, calendar integration).

- [ ] Write catalog topic: `service_docs/integrations/booking-and-scheduling.md` (or under a new `commerce/` category if more booking-adjacent topics are coming).
- [ ] Reference: tutor_billing's session/booking flow, reminder cron, calendar sync, cancellation/late-cancellation rules.
- [ ] Optional portfolio demo: a "book a 15-min consult" widget on PortfolioWebsite — small, sellable proof of concept.

### 10. SMS reminders / 2FA (Twilio-style)
Vorbiz already implements SMS 2FA — the same pattern adapts to appointment reminders, order status, two-way support. Distinct from email; SMB owners specifically ask for it.

- [ ] Write catalog topic: `service_docs/integrations/sms.md`.
- [ ] Reference vorbiz's 2FA flow (verification code generation, send via Twilio/provider, verify with expiry + retry limit, rate-limit per phone). Note that the same provider client + send wrapper extends to reminder/marketing sends.
- [ ] Cover: opt-in consent, STOP/HELP keywords, A2P 10DLC registration for US, quiet-hours, cost monitoring.
- [ ] Optional portfolio demo: pair with the booking widget — text reminder before the consult.

### 11. Accessibility audit + fixes
High-margin fixed-fee engagement, real ADA / WCAG lawsuit risk for retail/restaurant sites. No strong case study yet — best move is to make PortfolioWebsite itself the case study.

- [ ] Write catalog topic: `service_docs/quality/accessibility.md` (new `quality/` category, or fold under `seo/` since SEO and a11y overlap).
- [ ] Checklist content: WCAG 2.1 AA target — semantic HTML / heading order, alt text, form labels + error association, color contrast (4.5:1 body / 3:1 large), keyboard navigation, focus-visible, skip-to-content, ARIA only where native HTML can't, prefers-reduced-motion, screen-reader testing path.
- [ ] Tooling: axe DevTools, Lighthouse a11y, Pa11y CI; manual testing with VoiceOver / NVDA.
- [ ] Eat the dog food: run the audit on PortfolioWebsite, document the before/after, use that as the case study in the catalog topic itself.

---

## Low priority — project-specific elsewhere, hard to bolt on naturally

These are genuine services, but their natural homes are other projects in your portfolio. Skip unless you want a second worked example.

- **AI deep research** — lives in weekendplant (`garden_skills/`).
- **AI data audit** — lives in cookjunkie (`data/audit_01/`) and weekendplant (`scripts/enrich-plants.ts`).
- **Offline-first sync** — lives in vorbiz-api (mobile + Drizzle backend).
- **Stripe Connect / platform** — lives in tutor_billing if you need the marketplace flavor (the simpler direct-accept demo above is enough for portfolio purposes).
- **AJAX data minimization** — checklist topic, no code demo expected.

---

## Bonus topics PortfolioWebsite *has* but the catalog doesn't (yet)

These came out of the earlier survey. If any feel like sellable services, ask Claude to add them as catalog entries.

- **api/usage-metering** — per-user API keys with quota enforcement, separate from UI usage. `src/app/embroidery/_lib/api-key-actions.ts`, `src/app/api/embroidery/generate/route.ts`.
- **image/vector-tracing** — Python worker with potrace + perceptual Lab color matching + halo cleanup. `worker/main.py`.

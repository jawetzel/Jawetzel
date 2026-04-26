# PortfolioWebsite — Selling-Point Gaps

Audit against `C:\Repo\service_docs\` catalog. Already covered: OAuth, encryption, sitemap, in-page SEO, AI chat with tool calls, AI assisted workflows (embroidery pipeline), bot-blocking, rate-limiting, data aggregation, secure files, emails, OpenAPI docs.

Below: catalog topics PortfolioWebsite *doesn't* currently demonstrate.

---

## High value — table stakes for what you sell

### 1. Security headers
Hard to pitch security/compliance work without these.

- [x] Add CSP via `src/proxy.ts` (per-request nonce, `'strict-dynamic'`, `default-src 'self'`). Origins listed: GA (`googletagmanager.com`, `*.google-analytics.com`, `stats.g.doubleclick.net`), R2 image host (`CLOUDFLARE_PUBLIC_URL`), YouTube thumbnails (`i.ytimg.com`), YouTube embed (`youtube-nocookie.com`). `'unsafe-inline'` only on `style-src` (19 inline `style={{...}}` props in JSX); script-src is nonce + strict-dynamic with no `'unsafe-inline'`. `'unsafe-eval'` allowed in dev only.
- [x] Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` via `next.config.ts` headers().
- [x] Add `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`, `Cross-Origin-Opener-Policy: same-origin` via `next.config.ts`.
- [x] Skipped `X-Frame-Options` in favor of CSP `frame-ancestors 'none'`.
- [ ] Verify with [securityheaders.com](https://securityheaders.com) once deployed; aim for A grade.
- [x] Add `Cache-Control: no-store` for `/embroidery`, `/api/auth/*`, `/api/chat/*`, `/api/embroidery/*` (all in `proxy.ts`).
- [ ] Reference: `C:\Repo\service_docs\security\security-headers.md`.

---

## Medium value — pairs well with existing features

### 2. Magic-link auth
Pairs with the existing Google OAuth.

- [x] Stateful 32-byte CSPRNG token (`src/lib/magic-link.ts`); held in the in-process memory cache (`src/lib/cache.ts`) keyed by raw token, value `{ email }`, 30-min TTL. No DB writes — server restart drops outstanding tokens, which the verify page surfaces as the same generic "link isn't good anymore" message.
- [x] `POST /api/auth/magic-link` — rate-limited (3/IP/5min), validates email, always returns `{ ok: true }` (no enumeration).
- [x] Email link: `${NEXTAUTH_URL}/auth/verify?token=...&callbackUrl=...` via Brevo (`sendMagicLinkEmail` in `src/lib/email.ts`).
- [x] `/auth/verify` client page calls `signIn("magic-link", { token })`; NextAuth `CredentialsProvider` (id="magic-link") wraps `consumeMagicLinkToken`.
- [x] `Referrer-Policy: no-referrer` set on `/auth/verify` in `proxy.ts`. Also added to no-store list so the token URL is never cached.
- [x] **User records are only created at consume-time**, not at send-time — sending a link to an arbitrary email does NOT register that email. `findOrCreateByEmail` runs only after the recipient clicks the link, proving control of the address. `findOrCreateGoogleUser` reuses email-matched magic-link records instead of duplicating.
- [x] Single-use enforced by `deleteCached(token)` immediately after the synchronous `getCached` read — JS single-threading makes get-then-delete atomic, so a concurrent verify can't see the same token. Used, expired, wiped-by-restart, never-existed all collapse into one `{ valid: false }` result so the UI never reveals which one happened.
- [x] UI: `MagicLinkForm` component slotted next to `SignInButton` on the embroidery page.
- [ ] Reference: `C:\Repo\service_docs\authentication\magic-links.md`.

### 3. IndexNow
Cheap addition given the existing sitemap.

- [x] 32-char hex key `25238df6c5c7fef5a172e7d0965490e3` (override via `INDEXNOW_KEY` env). Hosted at `public/25238df6c5c7fef5a172e7d0965490e3.txt`.
- [x] `submitToIndexNow(urls)` in `src/lib/indexnow.ts` POSTs `{ host, key, keyLocation, urlList }` in 1000-URL batches; logs per-batch success/fail; fail-soft (network errors swallowed for retry next run).
- [x] Cron-only (no immediate-on-publish since blog/projects are JSON files, not a runtime CMS). Weekly sweep — Wednesday 04:30 US Eastern, registered in `src/worker/index.ts`.
- [x] New collection `indexnow_log` (`src/lib/indexnow-tracker.ts`) — `{ pagePath, contentUpdatedAt, lastPingedAt }`. Sweep upserts content dates from sitemap sources, queries due URLs (`lastPingedAt null` OR `contentUpdatedAt > lastPingedAt` OR `lastPingedAt < now-7d`), submits, stamps on success. Failed batches leave `lastPingedAt` unchanged so they retry.
- [ ] Reference: `C:\Repo\service_docs\seo\indexnow.md`.

---

## Catalog gaps from sales review (SMB-pitch perspective)

These came out of thinking about what local-business owners actually pay for. Each one needs a catalog topic written; some also benefit from a PortfolioWebsite demo.

### 4. Booking / scheduling
Highly sellable to dentists, salons, contractors, gyms, tutors. Fully covered in `tutor_billing` (availability windows, booking flow, reminders, cancellation policy, calendar integration).

- [ ] Write catalog topic: `service_docs/integrations/booking-and-scheduling.md` (or under a new `commerce/` category if more booking-adjacent topics are coming).
- [ ] Reference: tutor_billing's session/booking flow, reminder cron, calendar sync, cancellation/late-cancellation rules.
- [ ] Optional portfolio demo: a "book a 15-min consult" widget on PortfolioWebsite — small, sellable proof of concept.

### 5. SMS reminders / 2FA (Twilio-style)
Vorbiz already implements SMS 2FA — the same pattern adapts to appointment reminders, order status, two-way support. Distinct from email; SMB owners specifically ask for it.

- [ ] Write catalog topic: `service_docs/integrations/sms.md`.
- [ ] Reference vorbiz's 2FA flow (verification code generation, send via Twilio/provider, verify with expiry + retry limit, rate-limit per phone). Note that the same provider client + send wrapper extends to reminder/marketing sends.
- [ ] Cover: opt-in consent, STOP/HELP keywords, A2P 10DLC registration for US, quiet-hours, cost monitoring.
- [ ] Optional portfolio demo: pair with the booking widget — text reminder before the consult.

### 6. Accessibility audit + fixes
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

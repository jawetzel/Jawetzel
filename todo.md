# PortfolioWebsite — Selling-Point Gaps

Audit against `C:\Repo\service_docs\` catalog. Already covered: OAuth, magic-link auth, encryption, sitemap, in-page SEO, security headers (CSP nonces / HSTS / etc.), IndexNow, AI chat with tool calls, AI assisted workflows (embroidery pipeline), bot-blocking, rate-limiting, data aggregation, secure files, emails, OpenAPI docs.

Below: catalog topics PortfolioWebsite *doesn't* currently demonstrate.

---

## Catalog gaps from sales review (SMB-pitch perspective)

These came out of thinking about what local-business owners actually pay for. Each one needs a catalog topic written; some also benefit from a PortfolioWebsite demo.

### 1. Accessibility audit + fixes
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

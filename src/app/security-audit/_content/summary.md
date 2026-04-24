# Security Audit — [company]

**Date:** Early 2026 · **Type:** Non-intrusive public information review

## What was exposed

Using nothing but a web browser — no credentials, no insider knowledge — the following was publicly accessible on [company]'s website:

- **Warehouse inventory layouts** showing where widgets, consumable widgets, and hazardous widgets were stored, with real-time headcount of who was on each floor.
- **60+ employee names with direct phone extensions**, which is everything a social-engineering attacker needs to impersonate staff.
- **A list of customers, their contacts, and their financial information**, served to the public both through the web app and through a public file-storage bucket.
- **Live inventory counts for ~45,000 products**, enough for a competitor to track stock levels in real time.
- **~8,500 invoices, ~2,900 payment records, and the wholesale cost of every product in the catalog.**

All of it reachable with no login and no authentication check.

## Why it happened

Three patterns accounted for most of the findings:

1. **Internal dashboards reachable without a login.** Pages were built for employees but never wired to the login system, and were eventually indexed by search engines so Google listed them publicly.
2. **Customer documents in public storage with guessable URLs.** Statement PDFs were generated on demand and parked on a public bucket with the customer ID in the filename, so one URL gave away the pattern for every other customer's file.
3. **Server responses that contained the data the UI hides.** The screen showed "—" and "hidden," while the underlying response shipped to the browser in full.

## Severity summary

| Priority | Count | Examples |
|---|---|---|
| High | 4 | Unauthenticated internal dashboards · customer documents on public storage · product & pricing data leaked in-page · internal paths indexed by search engines |
| Medium | 3 | Employee PII + live call availability · warehouse layout with regulated-inventory locations · live call metrics auto-refreshing |

See [Internal pages exposed](./details-dashboards) and [Data leaks](./details-data-leaks) for the drill-down. [Scope](./scope) covers what was and was not examined.

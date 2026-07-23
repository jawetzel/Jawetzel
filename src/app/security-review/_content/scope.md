# Audit Scope

## What Was Covered

| Area | Coverage |
|---|---|
| HTTP Response Headers | Full |
| TLS/SSL Configuration | Full |
| Homepage & Page HTML Source | Full |
| JavaScript Variables & Logic | Full |
| Cookies & Attributes | Full |
| robots.txt / XML Sitemap | Full |
| Admin Endpoint Accessibility | Full (19 endpoints) |
| Product Search/Detail/Category/Department Pages | Full |
| AJAX Endpoint Discovery | Full (8 page types) |
| CORS Policy | Full |
| Admin Dashboard Data Exposure | Full (14 dashboards) |
| Normal User Flow Data Exposure | Full (11 page types) |
| Product Detail Data Exposure | Full (9 products) |

**Total unique pages/endpoints examined: 76+**

## What Was NOT Covered

| Area | Reason |
|---|---|
| Authenticated session behavior | No login credentials available |
| API endpoint fuzzing/enumeration | Requires authorization |
| SQL injection / XSS testing | Requires authorization |
| File/directory brute-forcing | Requires authorization |
| Rate limiting / DoS resilience | Requires authorization |
| Subdomain enumeration | Out of scope |
| Email security (SPF/DKIM/DMARC) | Out of scope |
| Mobile app / API analysis | Out of scope |
| Payment processing (PCI compliance) | Requires authorized assessment |
| Source code review | No access to server-side source code |

---

<!-- pagebreak -->

## Methodology

All findings were obtained through **passive browser-equivalent observation**:

- Visiting pages as an anonymous visitor would
- Reading source code of pages served to anonymous visitors
- Observing AJAX responses triggered by normal UI interaction (clicking published buttons)
- Reviewing HTTP headers, cookies, and TLS configuration

No credentials were used. No fuzzing, brute-forcing, injection, or enumeration was performed. No write operations were attempted — several endpoints *appeared* to support destructive actions (creating/deleting records, modifying customer data) but none were invoked.

This scoping discipline is deliberate. A zero-knowledge audit that finds this much has a very different legal and ethical posture than an authorized penetration test, and the report is intentionally limited to what could be observed from a browser.

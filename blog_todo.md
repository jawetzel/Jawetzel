# Blog Post Ideas

## Why Data Security Matters

**Format:** article + companion video (`kind: "both"`)

**Core thesis:** If you're exposing data in a way you didn't intend, assume it's already gone. There are companies scraping all publicly available data 24/7.

**Why it matters:**
- Competitors paying for advantage — scraped data feeds pricing intelligence, lead lists, product comparisons
- Regulatory exposure — some data releases are compliance violations the moment they go public (PII, PHI, financial)
- Permanence — if it's out there, it's been scraped and stored, likely forever. Taking it down later doesn't take it back

**Tie-in to existing site content:**
- Reference back to `/security-audit` — the redacted case study of a mid-size B2B distributor where I found a severe data exposure, reported it for free, and got no response. That page is the proof-of-work; this post is the "why you should care" that links into it.
- Link from this post into the audit page for the concrete patterns (dashboards, data leaks, scope).
- Consider a back-link from the audit page's intro/outro to this post once it ships.

**Companion video:**
- Walk through the three "why" bullets above
- Quick demo of the Cloudflare dashboard showing the constant bot bombardment hitting this site (or another property) — proves the "scrapers run 24/7" claim isn't theoretical
- Keep it tight; the article carries the depth, the video carries the visceral "look at this traffic" moment

**Angles to develop:**
- Real examples of "we'll fix it later" exposures that got harvested before the fix shipped
- The threat model isn't just "hackers" — it's commercial scrapers running constantly against every public surface
- What "publicly available" actually means in 2026 (anything reachable without auth, including misconfigured S3, debug endpoints, indexed search results, exposed API responses)
- Practical defaults: assume every endpoint is public until proven otherwise; treat staging URLs as production; rotate anything that ever touched a public log

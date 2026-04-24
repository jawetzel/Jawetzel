# Security Checklist

Topics to be aware of when bringing an inherited project up to par.

## No Secrets In Code

- [ ] Hardcoded secrets in source
- [ ] Secrets in git history
- [ ] .env files in .gitignore
- [ ] Editor / AI-tool config directories gitignored
- [ ] Production secrets in host env vars (not source)
- [ ] Rotation plan

## Network & headers

- [ ] HTTPS enforcement
- [ ] HSTS
- [ ] Content-Security-Policy
- [ ] X-Frame-Options / frame-ancestors
- [ ] X-Content-Type-Options
- [ ] Referrer-Policy
- [ ] Server / X-Powered-By stripped

## Anti-scraper

### Edge middleware / reverse-proxy layer

- [ ] Block list (SEO-data crawlers, AI-training crawlers)
  - mj12bot
  - barkrowler
  - ahrefsbot
  - semrushbot
  - bytespider
  - gptbot
  - serankingbacklinksbot
  - generic `(compatible; crawler)`
  - ancient Chrome (>7 years out of date)
- [ ] Allow list (search engines, social-card fetchers, AI live-fetch UAs)
  - googlebot, googlebot-image, google-adstxt, google-inspectiontool
  - bingbot, bingpreview
  - duckduckbot, qwantbot
  - facebookexternalhit, meta-webindexer
  - chatgpt-user, oai-searchbot
  - claudebot, claude-user
  - cfnetwork, wordpress
- [ ] JS challenge for unknown clients
- [ ] Challenge signing secret

## Data protection

- [ ] Minimize data delivered to UI for use case only


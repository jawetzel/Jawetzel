# I watched competitors scrape Weekend Plant. Then I stopped them with about 40 lines of code.

*Draft — competitive security post.*

**Title:** I watched competitors scrape Weekend Plant. Then I stopped them with about 40 lines of code.
**Description:** Railway logs of SemrushBot, AhrefsBot, and friends pulling Weekend Plant content straight into competitor dashboards — and the three-layer defense that cut it to zero without touching SEO.
**Tags:** security, competitive-intel, nextjs
**Kind:** both
**YouTube:** [drop video ID once uploaded]

---

## The log that started this

Real Railway traffic from weekendplant.com, before any of the defenses below were on:

```
[Railway logs — paste actual snippet here, unredacted]
2026-XX-XX HH:MM:SS  GET /plants/begonia   200  312ms  "SemrushBot/7~bl; +http://www.semrush.com/bot.html"
2026-XX-XX HH:MM:SS  GET /plants/hosta     200  289ms  "SemrushBot/7~bl; +http://www.semrush.com/bot.html"
2026-XX-XX HH:MM:SS  GET /plants/coleus    200  304ms  "AhrefsBot/7.0; +http://ahrefs.com/robot/"
```

Every one of those 200s is a full Weekend Plant plant profile — the content, the growing guides, the photographs, the prose I drafted with AI and hand-edited to sound like a person wrote it. SemrushBot reads it, Ahrefs reads it, a half-dozen smaller crawlers read it, and all of them repackage it into a dashboard that a competitor pays $120 a month to browse.

That's not hacking. It's an invited guest I forgot to disinvite.

This post is how I disinvited them, in three layers, with about 40 lines of code and zero third-party bot managers.

## Why it matters

SEMrush isn't a bad company. Neither are Ahrefs, SimilarWeb, or SpyFu. They're useful tools that happen to be useful *to your competitors*. The data they sell is mostly your own public site, reassembled into a slide someone else's sales team uses against you.

Weekend Plant spends real money on content, photography, and AI-assisted drafting. Shipping that to a competitor's analytics dashboard for free is not the deal.

## Layer 1: robots.txt — the honest-bot layer

```typescript
// src/app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
```

robots.txt is a sign on the door, not a lock. The bots that respect it also respect per-User-Agent disallows, so you can name SemrushBot, AhrefsBot, MJ12bot, and the rest directly and they'll honor it — because they're branded products and misbehavior becomes a support ticket they don't want.

The shady ones — anything selling "competitor intelligence" without a real company name on it — ignore robots.txt entirely. So this layer filters the polite half and does nothing for the rest.

## Layer 2: the User-Agent blocklist

The enforcement layer. Runs in the Next.js proxy on every request, costs microseconds.

```typescript
// src/proxy.ts
const BLOCKED_BOTS = [
  "mj12bot",
  "barkrowler",
  "ahrefsbot",
  "semrushbot",
  "bytespider",
  "gptbot",
  "claudebot",
  "(compatible; crawler)",
  "serankingbacklinksbot",
];

export async function proxy(request: NextRequest) {
  const ua = request.headers.get("user-agent");
  if (isBlockedBot(ua) || isAncientChrome(ua)) {
    return new NextResponse(null, { status: 403 });
  }
  // ...
}
```

The `isAncientChrome` check is the clever bit: curl, Python requests, and most off-the-shelf scraping kits ship a default User-Agent that's years out of date. Any Chrome older than about seven years is almost certainly not a real Chrome — so it gets a 403 before the request touches a route handler.

Log lines after this layer turned on:

```
[Railway logs — paste actual snippet here]
2026-XX-XX HH:MM:SS  GET /plants/begonia   403   2ms  "SemrushBot/7~bl..."
2026-XX-XX HH:MM:SS  GET /plants/hosta     403   2ms  "AhrefsBot/7.0..."
2026-XX-XX HH:MM:SS  GET /plants/coleus    403   2ms  "Mozilla/5.0 ... Chrome/78..."
```

Same bots, same endpoints, 403 every time, two milliseconds each.

## Layer 3: the JavaScript challenge

User-Agent blocking only stops bots dumb enough to announce themselves. The smarter ones rotate through a list of real Chrome User-Agents. So the third layer is: prove you can execute JavaScript.

```typescript
function challengeResponse(token: string): NextResponse {
  const html =
    `<!DOCTYPE html><html><head></head><body>` +
    `<script>document.cookie="__vc=${token};path=/;max-age=86400;SameSite=Lax";` +
    `location.replace(location.href)</script>` +
    `<noscript><p>Please enable JavaScript to continue.</p></noscript>` +
    `</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
```

First visit: browser gets a tiny HTML page, a line of JavaScript sets a signed cookie, page redirects back. Real browsers blow through it in about 30 milliseconds. Scrapers that don't run JavaScript (most of them, because headless browsers are expensive at scale) get stuck serving themselves the same challenge page over and over.

The cookie is an HMAC-signed token that rotates daily. The server validates it statelessly — no database write, no cache lookup. Googlebot, Bingbot, and friends live on a separate allowlist and skip the challenge entirely, so organic search is untouched.

Log of a rotating-UA scraper hitting the challenge:

```
[Railway logs — paste actual snippet here]
2026-XX-XX HH:MM:SS  GET /plants/begonia   200  12ms  "Mozilla/5.0 ... Chrome/122..."  ← challenge served
2026-XX-XX HH:MM:SS  GET /plants/begonia   200  14ms  "Mozilla/5.0 ... Chrome/122..."  ← same, no cookie (didn't run JS)
2026-XX-XX HH:MM:SS  GET /plants/begonia   200  11ms  "Mozilla/5.0 ... Chrome/122..."  ← same again
```

Three requests. Three challenge pages. Zero plant content.

## The moneyshot: before and after

[Paste side-by-side log windows here — same day of week, same handful of routes, before and after all three layers are on.]

**Before:**
```
[Railway — before]
```

**After:**
```
[Railway — after]
```

Known-bot reads of plant content went to zero. Googlebot and Bingbot are still crawling normally, organic rankings unchanged. The bot managers at Cloudflare, Fastly, and Akamai all do a more sophisticated version of this for sites that need it — but for a small-to-midsize site, 40 lines of middleware and a single robots.ts get you most of the way there.

## What it cost

- One `src/app/robots.ts`, about 8 lines
- One `src/proxy.ts` with the UA blocklist, the ancient-Chrome heuristic, and the JS challenge — about 40 lines of actual logic
- Zero third-party services, zero subscriptions, zero ongoing config

The hardest part was picking the starter blocklist, and even that's copy-pasteable from any site that's already running it.

## Want your own

If you're a B2B company whose product catalog, pricing, or content is being pulled into a competitor's dashboard, [tell me](/contact) — I'll run the same audit on your site and hand you the report. It pairs with the [zero-knowledge security audit on this site](/security-audit): same methodology, different target.

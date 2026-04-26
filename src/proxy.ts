import { createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * 1. Block known bad bots (403).
 * 2. JS challenge — first visit serves a tiny page whose JS sets a signed
 *    cookie, then redirects back. Bots that don't execute JS never pass.
 * 3. Per-request nonce + strict CSP, with HSTS-friendly defense-in-depth
 *    headers handled in next.config.ts.
 */

/** Blocked bot UA substrings (case-insensitive match). */
const BLOCKED_BOTS = [
  "mj12bot",
  "barkrowler",
  "ahrefsbot",
  "semrushbot",
  "bytespider",
  "gptbot",
  "(compatible; crawler)",
  "serankingbacklinksbot",
];

function isBlockedBot(ua: string | null): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return BLOCKED_BOTS.some((bot) => lower.includes(bot));
}

/** Chrome 80 ≈ Feb 2020. ~13 major versions per year. */
const CHROME_EPOCH_VERSION = 80;
const CHROME_EPOCH_MS = Date.parse("2020-02-01");
const CHROME_VERSIONS_PER_YEAR = 13;

function isAncientChrome(ua: string | null): boolean {
  if (!ua) return false;
  const match = ua.match(/Chrome\/(\d+)\./);
  if (!match) return false;
  const version = parseInt(match[1]);
  const yearsSinceEpoch =
    (Date.now() - CHROME_EPOCH_MS) / (365.25 * 24 * 60 * 60 * 1000);
  const currentVersion =
    CHROME_EPOCH_VERSION +
    Math.floor(yearsSinceEpoch * CHROME_VERSIONS_PER_YEAR);
  return version < currentVersion - 7 * CHROME_VERSIONS_PER_YEAR;
}

/** Known good non-browser crawlers — skip JS challenge. */
const ALLOWED_BOTS = /googlebot|google-adstxt|googlebot-image|google-inspectiontool|bingbot|bingpreview|meta-webindexer|facebookexternalhit|chatgpt-user|oai-searchbot|claudebot|claude-user|qwantbot|cfnetwork|duckduckbot|wordpress/i;

function isAllowedBot(ua: string | null): boolean {
  if (!ua) return false;
  return ALLOWED_BOTS.test(ua);
}

// ── JS challenge ──────────────────────────────────────────────────────────────
const CHALLENGE_COOKIE = "__vc";
const CHALLENGE_MAX_AGE = 86400; // 24 hours

/** HMAC-signed token that rotates daily. Server can validate without state. */
function challengeToken(): string {
  const secret = process.env.PROXY_CHALLENGE_SECRET || "ab2c1bd9362ffcae1ecaeac5e9d2524a";
  const day = Math.floor(Date.now() / (CHALLENGE_MAX_AGE * 1000));
  return createHmac("sha256", secret).update(String(day)).digest("hex").slice(0, 32);
}

/** Accept today's or yesterday's token so cookies don't break at midnight. */
function isValidChallenge(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const secret = process.env.PROXY_CHALLENGE_SECRET || "ab2c1bd9362ffcae1ecaeac5e9d2524a";
  const day = Math.floor(Date.now() / (CHALLENGE_MAX_AGE * 1000));
  const today = createHmac("sha256", secret).update(String(day)).digest("hex").slice(0, 32);
  const yesterday = createHmac("sha256", secret).update(String(day - 1)).digest("hex").slice(0, 32);
  return cookie === today || cookie === yesterday;
}

/** Only challenge page navigations — skip API, static files, and good crawlers. */
function shouldChallenge(pathname: string, ua: string | null): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/embroidery/")) return false;
  if (pathname === "/robots.txt" || pathname.startsWith("/sitemap")) return false;
  if (pathname === "/favicon.ico") return false;
  // The JS challenge is only meant for HTML page navigations. Next.js
  // serves those at extension-less paths (e.g. `/about`, `/blog/foo`), so
  // anything with a file extension is a static asset — images, scripts,
  // stylesheets, fonts, PDFs, data files — and should pass through.
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  if (isAllowedBot(ua)) return false;
  return true;
}

function challengeResponse(token: string, nonce: string, csp: string): NextResponse {
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    `<script nonce="${nonce}">document.cookie="${CHALLENGE_COOKIE}=${token};path=/;max-age=${CHALLENGE_MAX_AGE};SameSite=Lax";` +
    `location.replace(location.href)</script>` +
    `<noscript><p>Please enable JavaScript to continue.</p></noscript>` +
    `</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": "private, no-store",
    },
  });
}

// ── CSP ──────────────────────────────────────────────────────────────────────
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const r2Public = process.env.CLOUDFLARE_PUBLIC_URL?.trim();
  const imgExtras = ["https://i.ytimg.com", r2Public].filter(Boolean).join(" ");
  const scriptExtras = isDev ? " 'unsafe-eval'" : "";

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${scriptExtras}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: ${imgExtras} https://www.google-analytics.com https://www.googletagmanager.com`.trim(),
    `font-src 'self' data:`,
    `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://stats.g.doubleclick.net`,
    `frame-src https://www.youtube-nocookie.com`,
    `media-src 'self'`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

/** Authenticated / per-user paths that must never be cached by intermediaries. */
function needsNoStore(pathname: string): boolean {
  if (pathname === "/embroidery") return true;
  if (pathname === "/auth/verify") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/chat/")) return true;
  if (pathname.startsWith("/api/embroidery/")) return true;
  return false;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Blocked bot check ──
  const ua = request.headers.get("user-agent");
  if (isBlockedBot(ua) || isAncientChrome(ua)) {
    return new NextResponse(null, {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const nonce = randomBytes(16).toString("base64");
  const csp = buildCsp(nonce);

  // ── JS challenge (must execute JavaScript to proceed) ──
  if (shouldChallenge(pathname, ua)) {
    const cookie = request.cookies.get(CHALLENGE_COOKIE)?.value;
    if (!isValidChallenge(cookie)) {
      return challengeResponse(challengeToken(), nonce, csp);
    }
  }

  // Forward nonce to server components so they can attach it to inline tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (needsNoStore(pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }
  // Magic-link tokens travel in the URL. Tighten Referrer-Policy on the
  // verify page so the token does not leak to any outbound request the
  // browser makes from that document (analytics beacons, link clicks, etc).
  if (pathname === "/auth/verify") {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

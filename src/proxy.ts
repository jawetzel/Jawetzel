import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * 1. Block known bad bots (403).
 * 2. JS challenge — first visit serves a tiny page whose JS sets a signed
 *    cookie, then redirects back. Bots that don't execute JS never pass.
 */

/** Blocked bot UA substrings (case-insensitive match). */
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
const ALLOWED_BOTS = /googlebot|google-adstxt|googlebot-image|bingbot|meta-webindexer|facebookexternalhit|chatgpt-user|oai-searchbot|qwantbot|cfnetwork|duckduckbot|wordpress/i;

function isAllowedBot(ua: string | null): boolean {
  if (!ua) return false;
  return ALLOWED_BOTS.test(ua);
}

// ── JS challenge ──────────────────────────────────────────────────────────────
const CHALLENGE_COOKIE = "__vc";
const CHALLENGE_MAX_AGE = 86400; // 24 hours

/** HMAC-signed token that rotates daily. Server can validate without state. */
function challengeToken(): string {
  const secret = process.env.PROXY_CHALLENGE_SECRET || "";
  const day = Math.floor(Date.now() / (CHALLENGE_MAX_AGE * 1000));
  return createHmac("sha256", secret).update(String(day)).digest("hex").slice(0, 32);
}

/** Accept today's or yesterday's token so cookies don't break at midnight. */
function isValidChallenge(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const secret = process.env.PROXY_CHALLENGE_SECRET || "";
  const day = Math.floor(Date.now() / (CHALLENGE_MAX_AGE * 1000));
  const today = createHmac("sha256", secret).update(String(day)).digest("hex").slice(0, 32);
  const yesterday = createHmac("sha256", secret).update(String(day - 1)).digest("hex").slice(0, 32);
  return cookie === today || cookie === yesterday;
}

/** Only challenge page navigations — skip API, static files, and good crawlers. */
function shouldChallenge(pathname: string, ua: string | null): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname === "/robots.txt" || pathname.startsWith("/sitemap")) return false;
  if (pathname === "/favicon.ico") return false;
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(pathname)) return false;
  if (isAllowedBot(ua)) return false;
  return true;
}

function challengeResponse(token: string): NextResponse {
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    `<script>document.cookie="${CHALLENGE_COOKIE}=${token};path=/;max-age=${CHALLENGE_MAX_AGE};SameSite=Lax";` +
    `location.replace(location.href)</script>` +
    `<noscript><p>Please enable JavaScript to continue.</p></noscript>` +
    `</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
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

  // ── JS challenge (must execute JavaScript to proceed) ──
  if (shouldChallenge(pathname, ua)) {
    const cookie = request.cookies.get(CHALLENGE_COOKIE)?.value;
    if (!isValidChallenge(cookie)) {
      return challengeResponse(challengeToken());
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/).*)",
};

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Route,
} from "playwright";
import { ok, err, type Result } from "@/domain/shared/result";
import {
  type CrawlFailure,
  type CrawlFailureReason,
  type FetchedPage,
  type PageCrawlGateway,
} from "@/application/ports/page-crawl-gateway";
import { hostIsPublic, isFetchableScheme } from "./private-address";

/**
 * PlaywrightPageCrawlGateway — a headless-Chromium {@link PageCrawlGateway}.
 *
 * Why a browser at all: some pages don't exist until JavaScript runs. jawetzel
 * itself gates non-JS clients with a cookie-set-and-reload interstitial
 * (`proxy.ts`), and half the competitor set (job boards, SPA marketing sites)
 * renders its body client-side. A plain `fetch` sees the pre-hydration shell and
 * measures nothing. This adapter runs the page the way Google's renderer does,
 * so the facts reflect what a user — and the index — actually get.
 *
 * SSRF is *more* dangerous here than with `fetch`, because a browser follows
 * client-side redirects and loads every subresource. The same shared allowlist
 * ({@link hostIsPublic}) therefore gates EVERY request the page makes — the main
 * document, each redirect hop, and each subresource — via `context.route`. A
 * private-addressed request is aborted, not fetched. Nothing reaches
 * `169.254.169.254` because the browser is never allowed to open the socket.
 *
 * Lifecycle: the browser is an expensive process singleton, launched lazily and
 * reused across requests; each fetch gets its own disposable `BrowserContext`
 * (isolated cookies/cache) that is always closed. Never store request state on
 * the adapter — the singleton is shared across all in-flight requests.
 */

const USER_AGENT =
  "jawetzel-seo-bot/1.0 (+https://jawetzel.com/; SEO analysis on request)";
/** Total budget for one page: navigation + render + settle. */
const NAV_TIMEOUT_MS = 20_000;
/** After load, wait this long for late client-rendered content to appear. */
const SETTLE_MS = 1_200;
const MAX_BYTES = 6_000_000;
/** Concurrent browser contexts — cheaper than launches, but each costs RAM. */
const BATCH_CONCURRENCY = 4;

/**
 * A realistic desktop fingerprint. The JS challenge and many bot walls key off
 * a plausible UA + viewport; a headless default gives them an easy tell. We
 * still identify honestly in a custom header so a site owner can see who we are.
 */
const VIEWPORT = { width: 1366, height: 900 };

let browserPromise: Promise<Browser> | null = null;

/**
 * Launch (or reuse) the shared browser. `--no-sandbox` is required in most
 * container runtimes (Railway included) where the kernel sandbox isn't
 * available; it is safe here because the only thing this browser ever does is
 * load untrusted pages we already SSRF-gate, in a throwaway context.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-setuid-sandbox",
        ],
      })
      .then((browser) => {
        // If the browser dies (crash, OOM), drop the cached promise so the next
        // call relaunches instead of awaiting a dead instance forever.
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((cause) => {
        browserPromise = null;
        throw cause;
      });
  }
  return browserPromise;
}

/** Release the shared browser (tests / graceful shutdown). */
export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    (await pending).close();
  } catch {
    // Already gone — nothing to release.
  }
}

/** Map a thrown Playwright error to the port's failure vocabulary. */
function classify(cause: unknown): CrawlFailureReason {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("net::err_name_not_resolved")) return "network";
  if (message.includes("net::err_")) return "network";
  return "network";
}

export class PlaywrightPageCrawlGateway implements PageCrawlGateway {
  async fetchPage(url: string): Promise<Result<FetchedPage, CrawlFailure>> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return err({ url, reason: "blocked", detail: "Unparseable URL." });
    }
    if (!isFetchableScheme(target.protocol)) {
      return err({
        url,
        reason: "blocked",
        detail: `Unsupported scheme '${target.protocol}'.`,
      });
    }
    // Pre-flight the entry host, so an obviously-internal target never even
    // launches a context. Per-request routing (below) re-checks every hop.
    if (!(await hostIsPublic(target.hostname))) {
      return err({
        url,
        reason: "blocked",
        detail: "Host does not resolve to a public address.",
      });
    }

    let context: BrowserContext;
    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: VIEWPORT,
        javaScriptEnabled: true,
        serviceWorkers: "block",
        extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
      });
    } catch (cause) {
      console.error("[seo] Playwright context launch failed:", cause);
      return err({ url, reason: "network", detail: "Browser unavailable." });
    }

    // Whether any request in this navigation tried to reach a blocked address.
    let sawBlockedRequest = false;

    try {
      // SSRF gate on EVERY request the page makes — document, redirects, and
      // every subresource. This is what makes a browser safe to point at a
      // caller-supplied URL.
      await context.route("**/*", async (route: Route) => {
        const requestUrl = route.request().url();
        let host: string;
        let protocol: string;
        try {
          const parsed = new URL(requestUrl);
          host = parsed.hostname;
          protocol = parsed.protocol;
        } catch {
          sawBlockedRequest = true;
          return route.abort("blockedbyclient");
        }
        if (!isFetchableScheme(protocol) || !(await hostIsPublic(host))) {
          sawBlockedRequest = true;
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

      // `domcontentloaded` returns as soon as the HTML parses; we then settle
      // briefly for hydration and for the challenge's reload-with-cookie to
      // resolve. `networkidle` is deliberately avoided — analytics beacons and
      // long-poll connections keep it from ever firing on real sites.
      const response = await page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
      });

      const status = response?.status() ?? 0;
      // A hard error status with no rendered body is a genuine failure. (Many
      // pages return 200 after the JS challenge reload; that path is fine.)
      if (status >= 400) {
        return err({ url, reason: "http_error", statusCode: status });
      }

      await page.waitForTimeout(SETTLE_MS);

      const finalUrl = page.url();
      const html = await page.content();
      if (html.length > MAX_BYTES) {
        return err({ url, reason: "too_large", statusCode: status });
      }

      // If the only thing we could load was blocked and the page is empty, be
      // honest about it rather than returning a hollow success.
      if (sawBlockedRequest && html.length < 200) {
        return err({
          url,
          reason: "blocked",
          detail: "Navigation resolved to a non-public address.",
        });
      }

      return ok({
        url,
        finalUrl,
        statusCode: status || 200,
        html,
        fetchedAt: new Date().toISOString(),
      });
    } catch (cause) {
      return err({
        url,
        reason: classify(cause),
        detail: cause instanceof Error ? cause.message : "Navigation failed.",
      });
    } finally {
      // Always tear the context down — a leaked context leaks a renderer
      // process, and the singleton browser lives forever.
      await context.close().catch(() => {});
    }
  }

  async fetchPages(
    urls: string[],
  ): Promise<Array<Result<FetchedPage, CrawlFailure>>> {
    const results: Array<Result<FetchedPage, CrawlFailure>> = new Array(
      urls.length,
    );
    let cursor = 0;

    // Bounded pool over one shared browser: each worker opens/closes its own
    // context, so N contexts are alive at once, never N browsers.
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= urls.length) return;
        results[index] = await this.fetchPage(urls[index]);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, urls.length) }, worker),
    );
    return results;
  }
}

import { ok, err, type Result } from "@/domain/shared/result";
import {
  type CrawlFailure,
  type FetchedPage,
  type PageCrawlGateway,
} from "@/application/ports/page-crawl-gateway";
import { hostIsPublic, isFetchableScheme } from "./private-address";

/**
 * HttpPageCrawlGateway — a plain-`fetch` {@link PageCrawlGateway}.
 *
 * The lighter of the two crawlers: one GET, no JavaScript. Correct for the many
 * pages that server-render their content, and the fallback when a browser is
 * unavailable. Pages behind a JS challenge or client-rendered content need
 * {@link PlaywrightPageCrawlGateway} instead — this adapter would see only the
 * pre-hydration shell.
 *
 * It fetches URLs that arrive in a request body, so it is SSRF-guarded via the
 * shared {@link hostIsPublic} allowlist:
 *
 *   1. Scheme must be http(s) — no `file:`, `gopher:`, `data:`.
 *   2. The hostname is resolved and every returned address must be publicly
 *      routable (loopback, RFC1918, link-local, CGNAT, multicast all rejected).
 *   3. Redirects are followed MANUALLY, re-running (1) and (2) on each hop —
 *      following automatically would let a public URL 302 straight to an
 *      internal one, which is the standard way this check gets bypassed.
 *
 * A DNS record could still change between the check and the connect (classic
 * TOCTOU / rebinding). Closing that properly means pinning the resolved address
 * into the socket, which Node's fetch does not expose; the residual risk is one
 * unauthenticated GET whose body we parse but never echo verbatim, and the
 * endpoint itself is API-key gated.
 */

const USER_AGENT =
  "jawetzel-seo-bot/1.0 (+https://jawetzel.com/; SEO analysis on request)";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_BYTES = 4_000_000;
const MAX_REDIRECTS = 3;
/** Concurrent fetches in a batch — polite to hosts, fast enough for ten pages. */
const BATCH_CONCURRENCY = 5;

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true; // no header: assume HTML and let parsing decide
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

export class HttpPageCrawlGateway implements PageCrawlGateway {
  async fetchPage(url: string): Promise<Result<FetchedPage, CrawlFailure>> {
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let target: URL;
      try {
        target = new URL(current);
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
      if (!(await hostIsPublic(target.hostname))) {
        return err({
          url,
          reason: "blocked",
          detail: "Host does not resolve to a public address.",
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(target, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.9",
          },
        });
      } catch (cause) {
        const aborted = cause instanceof Error && cause.name === "AbortError";
        return err({
          url,
          reason: aborted ? "timeout" : "network",
          detail: cause instanceof Error ? cause.message : "Fetch failed.",
        });
      } finally {
        clearTimeout(timer);
      }

      // Manual redirect handling — the guard above re-runs on the next hop.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return err({ url, reason: "http_error", statusCode: response.status });
        }
        current = new URL(location, target).toString();
        continue;
      }

      if (!response.ok) {
        return err({ url, reason: "http_error", statusCode: response.status });
      }
      if (!isHtml(response.headers.get("content-type"))) {
        return err({
          url,
          reason: "not_html",
          statusCode: response.status,
          detail: response.headers.get("content-type") ?? undefined,
        });
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
        return err({ url, reason: "too_large", statusCode: response.status });
      }

      const html = await response.text();
      if (html.length > MAX_BYTES) {
        return err({ url, reason: "too_large", statusCode: response.status });
      }

      return ok({
        url,
        finalUrl: target.toString(),
        statusCode: response.status,
        html,
        fetchedAt: new Date().toISOString(),
      });
    }

    return err({ url, reason: "http_error", detail: "Too many redirects." });
  }

  async fetchPages(
    urls: string[],
  ): Promise<Array<Result<FetchedPage, CrawlFailure>>> {
    const results: Array<Result<FetchedPage, CrawlFailure>> = new Array(
      urls.length,
    );
    let cursor = 0;

    // A fixed pool of workers pulling from one cursor: bounded concurrency
    // without a dependency, and results land back in input order.
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

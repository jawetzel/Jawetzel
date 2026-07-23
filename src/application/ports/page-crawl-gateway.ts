import { type Result } from "@/domain/shared/result";

/**
 * PageCrawlGateway — a driven port for fetching a web page we do not own.
 *
 * Consumer-owned: `AnalyzePage` is its only consumer and needs exactly two
 * things — one page (the caller's), and a batch (the ranking competitors'). It
 * is named for the capability, not the transport; the production adapter is
 * `infrastructure/seo/HttpPageCrawlGateway` and tests use an in-memory fake
 * keyed by URL.
 *
 * "The sites are not participants" (seo.md §0) — nothing here calls an API a
 * property exposes. We fetch the same bytes any visitor would, which is what
 * makes the tool work uniformly across properties we don't own and stacks we
 * didn't build.
 *
 * The port returns raw HTML, never parsed facts: parsing is pure and belongs to
 * `domain/seo/page-facts`, so it stays unit-testable without a network.
 */

export interface FetchedPage {
  /** The URL requested. */
  url: string;
  /** The URL that actually answered, after redirects. */
  finalUrl: string;
  statusCode: number;
  html: string;
  /** ISO-8601 observation time — the provenance stamp on every derived fact. */
  fetchedAt: string;
}

export type CrawlFailureReason =
  /** Host resolved to a private/loopback address, or the scheme isn't http(s). */
  | "blocked"
  | "timeout"
  | "http_error"
  /** 2xx, but not an HTML document (PDF, image, JSON). */
  | "not_html"
  | "too_large"
  | "network";

export interface CrawlFailure {
  url: string;
  reason: CrawlFailureReason;
  statusCode?: number;
  detail?: string;
}

export interface PageCrawlGateway {
  fetchPage(url: string): Promise<Result<FetchedPage, CrawlFailure>>;

  /**
   * Fetch a batch concurrently. Returns one Result per input URL, in input
   * order — a competitor that blocks us shrinks the crawled sample size and
   * must not fail the request, so failures come back as values, never throws.
   */
  fetchPages(urls: string[]): Promise<Array<Result<FetchedPage, CrawlFailure>>>;
}

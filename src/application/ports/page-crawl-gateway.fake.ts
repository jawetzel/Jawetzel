import { ok, err, type Result } from "@/domain/shared/result";
import {
  type CrawlFailure,
  type FetchedPage,
  type PageCrawlGateway,
} from "@/application/ports/page-crawl-gateway";

/**
 * In-memory {@link PageCrawlGateway} for unit tests: a URL → HTML map, plus an
 * optional set of URLs that fail. Records every requested URL so tests can
 * assert the batch actually went out (and that a snapshot hit skipped it).
 */
export class FakePageCrawlGateway implements PageCrawlGateway {
  readonly requested: string[] = [];

  constructor(
    private readonly pages: Record<string, string> = {},
    private readonly failures: Record<string, CrawlFailure["reason"]> = {},
    private readonly fetchedAt = "2026-07-22T00:00:00.000Z",
  ) {}

  async fetchPage(url: string): Promise<Result<FetchedPage, CrawlFailure>> {
    this.requested.push(url);
    const failure = this.failures[url];
    if (failure) return err({ url, reason: failure });
    const html = this.pages[url];
    if (html === undefined) return err({ url, reason: "http_error", statusCode: 404 });
    return ok({
      url,
      finalUrl: url,
      statusCode: 200,
      html,
      fetchedAt: this.fetchedAt,
    });
  }

  async fetchPages(
    urls: string[],
  ): Promise<Array<Result<FetchedPage, CrawlFailure>>> {
    return Promise.all(urls.map((url) => this.fetchPage(url)));
  }
}

import { type Routing, type RouteVerdict } from "@/domain/seo/routing";

/**
 * SeoRoutingRepository — one row per `(tag, pageUrl, keyword)` verdict.
 *
 * **This table is why the backlog exists.** "Keywords no page run ever claimed"
 * is set math over these rows, and it cannot be reconstructed at page twenty
 * from runs that only stored their own output. It has to be durable from the
 * first routing, which is why it landed with the router rather than after it.
 *
 * A human override sets `overridden`, and re-routing the same page must respect
 * it: the model gets to change its mind, a person's correction outranks it.
 */
export interface SeoRoutingRepository {
  /**
   * Upsert verdicts for one page. Rows already carrying `overridden: true` are
   * left alone — see the class note.
   */
  saveAll(input: {
    tag: string;
    pageUrl: string;
    routings: Routing[];
  }): Promise<{ written: number; preserved: number }>;

  /** Every routing for a tag, or just one page's. */
  list(input: {
    tag: string;
    pageUrl?: string;
    limit: number;
  }): Promise<Routing[]>;

  /** A human correction. Marks the row `overridden`. */
  override(input: {
    tag: string;
    pageUrl: string;
    keyword: string;
    verdict: RouteVerdict;
  }): Promise<boolean>;

  /** Distinct pages routed under this tag — the backlog's coverage figure. */
  countRoutedPages(input: { tag: string }): Promise<number>;
}

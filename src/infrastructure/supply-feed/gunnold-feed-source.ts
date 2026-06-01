import { pullGunnold } from "@/worker/jobs/sources/gunnold-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * GunnoldFeedSource — the production {@link SupplyFeedSource} for Gunold. It
 * wraps the unchanged `pullGunnold` parser (token scrape → JSON API), exposing
 * it as `{ name, pull }`. No parsing logic lives here; relocating the parser
 * into infrastructure is a deferred cleanup.
 */
export class GunnoldFeedSource implements SupplyFeedSource {
  readonly name = "gunnold";
  pull(): Promise<unknown> {
    return pullGunnold();
  }
}

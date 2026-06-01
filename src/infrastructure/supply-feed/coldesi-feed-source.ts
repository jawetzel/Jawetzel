import { pullColdesi } from "@/worker/jobs/sources/coldesi-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * ColdesiFeedSource — the production {@link SupplyFeedSource} for ColDesi. It
 * wraps the unchanged `pullColdesi` parser, exposing it as `{ name, pull }`. No
 * parsing logic lives here.
 */
export class ColdesiFeedSource implements SupplyFeedSource {
  readonly name = "coldesi";
  pull(): Promise<unknown> {
    return pullColdesi();
  }
}

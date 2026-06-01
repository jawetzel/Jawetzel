import { pullOhmycrafty } from "@/worker/jobs/sources/ohmycrafty-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * OhmycraftyFeedSource — the production {@link SupplyFeedSource} for OhMyCrafty.
 * It wraps the unchanged `pullOhmycrafty` parser, exposing it as `{ name, pull }`.
 * No parsing logic lives here.
 */
export class OhmycraftyFeedSource implements SupplyFeedSource {
  readonly name = "ohmycrafty";
  pull(): Promise<unknown> {
    return pullOhmycrafty();
  }
}

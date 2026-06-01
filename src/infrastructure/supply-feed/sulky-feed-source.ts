import { pullSulky } from "@/worker/jobs/sources/sulky-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * SulkyFeedSource — the production {@link SupplyFeedSource} for Sulky. It wraps
 * the unchanged `pullSulky` parser, exposing it as `{ name, pull }`. No parsing
 * logic lives here.
 */
export class SulkyFeedSource implements SupplyFeedSource {
  readonly name = "sulky";
  pull(): Promise<unknown> {
    return pullSulky();
  }
}

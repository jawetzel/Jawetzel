import { pullAllstitch } from "@/worker/jobs/sources/allstitch-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * AllstitchFeedSource — the production {@link SupplyFeedSource} for AllStitch.
 * It wraps the unchanged `pullAllstitch` parser, exposing it as `{ name, pull }`.
 * No parsing logic lives here.
 */
export class AllstitchFeedSource implements SupplyFeedSource {
  readonly name = "allstitch";
  pull(): Promise<unknown> {
    return pullAllstitch();
  }
}

import { pullThreadart } from "@/worker/jobs/sources/threadart-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * ThreadartFeedSource — the production {@link SupplyFeedSource} for ThreadArt.
 * It wraps the unchanged `pullThreadart` parser, exposing it as `{ name, pull }`.
 * No parsing logic lives here.
 */
export class ThreadartFeedSource implements SupplyFeedSource {
  readonly name = "threadart";
  pull(): Promise<unknown> {
    return pullThreadart();
  }
}

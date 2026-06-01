import { pullHabanddash } from "@/worker/jobs/sources/habanddash-pull";
import { type SupplyFeedSource } from "@/application/ports/supply-feed-source";

/**
 * HabanddashFeedSource — the production {@link SupplyFeedSource} for Hab+Dash.
 * It wraps the unchanged `pullHabanddash` parser, exposing it as `{ name, pull }`.
 *
 * Auth-gating is preserved exactly: Hab+Dash price data sits behind Magento's
 * customer-group pricing. With HABANDDASH_EMAIL + HABANDDASH_PASSWORD set in
 * env the parser mints a token and populates prices; without them it runs
 * anonymous (all prices null). That behavior lives entirely in the wrapped
 * parser — this adapter adds no auth logic.
 */
export class HabanddashFeedSource implements SupplyFeedSource {
  readonly name = "habanddash";
  pull(): Promise<unknown> {
    return pullHabanddash();
  }
}

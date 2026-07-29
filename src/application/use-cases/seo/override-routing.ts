import { pageKey, type RouteVerdict } from "@/domain/seo/routing";
import { type SeoRoutingRepository } from "@/application/ports/seo-routing-repository";

/**
 * OverrideRouting — a human correcting the classifier.
 *
 * The correction is durable and outranks every later re-route. That asymmetry
 * is the point of letting a model classify at all: it is allowed to be wrong,
 * because being wrong is cheap to fix and the fix sticks.
 */

export interface OverrideRoutingInput {
  tag: string;
  pageUrl: string;
  keyword: string;
  verdict: RouteVerdict;
}

export interface OverrideRouting {
  execute(input: OverrideRoutingInput): Promise<boolean>;
}

export function createOverrideRouting(deps: {
  routings: SeoRoutingRepository;
}): OverrideRouting {
  return {
    async execute(input) {
      return deps.routings.override({
        tag: input.tag,
        // Normalize the same way the router did, or the correction lands on a
        // key nothing reads.
        pageUrl: pageKey(input.pageUrl),
        keyword: input.keyword.trim().toLowerCase(),
        verdict: input.verdict,
      });
    },
  };
}

import {
  rankPile,
  withOpportunityScore,
  type GapKeyword,
  type ScoredGapKeyword,
} from "@/domain/seo/gap-pile";
import {
  backlogCoverage,
  computeBacklog,
  type Routing,
} from "@/domain/seo/routing";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";
import { type SeoRoutingRepository } from "@/application/ports/seo-routing-repository";

/**
 * ListBacklog — keywords no page run has ever claimed.
 *
 * The long-game output. One page's `create` verdict says almost nothing; after
 * twenty pages, the keywords still unclaimed are the property's real coverage
 * gaps, and no site crawl was ever needed to find them.
 *
 * **The coverage figure ships with the list, always.** After three pages the
 * residue is mostly "we haven't looked yet"; presenting it as a finding would
 * be the same dishonesty as returning a fabricated number for a fact we never
 * measured. The caller gets `pagesRouted` so they can weigh the list, exactly
 * as `insufficientHistory` does for the history facts.
 */

const MAX_ROWS = 1000;

export interface ListBacklogOutput {
  rows: ScoredGapKeyword[];
  coverage: {
    /** Distinct pages routed under this tag. The list's trustworthiness. */
    pagesRouted: number;
    /** Accepted keywords some page claimed as improve or enrich. */
    keywordsClaimed: number;
    /** Accepted keywords in total. */
    keywordsAccepted: number;
  };
}

export interface ListBacklog {
  execute(input: { tag: string }): Promise<ListBacklogOutput>;
}

export function createListBacklog(deps: {
  gaps: SeoGapRepository;
  routings: SeoRoutingRepository;
}): ListBacklog {
  return {
    async execute(input) {
      const [accepted, routings]: [GapKeyword[], Routing[]] = await Promise.all([
        deps.gaps.list({ tag: input.tag, status: "accepted", limit: MAX_ROWS }),
        deps.routings.list({ tag: input.tag, limit: MAX_ROWS }),
      ]);

      const rows = computeBacklog({ accepted, routings });
      const coverage = backlogCoverage(routings);

      return {
        rows: withOpportunityScore(rankPile(rows)),
        coverage: {
          ...coverage,
          keywordsAccepted: accepted.length,
        },
      };
    },
  };
}

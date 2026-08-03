import {
  rankBy,
  type GapKeyword,
  type GapSort,
  type GapStatus,
  type ScoredGapKeyword,
} from "@/domain/seo/gap-pile";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";

/**
 * ListGapKeywords — the read behind layer 2's review screen.
 *
 * Ranking happens here rather than in the repository so the order is a domain
 * decision (`rankBy`) testable without a database, and so a caller filtering
 * by bucket still gets the same relative ordering.
 *
 * **The default returns the whole pile.** It used to be 200, which was a cap
 * across *both* buckets combined — so a property with a thousand keywords had
 * eight hundred of them silently invisible, the bucket tallies on screen were
 * tallies of the window rather than of the pile, and "show rejected" could
 * reveal nothing because the rejected rows had never been sent. A working set
 * this size is a megabyte of JSON to an admin-only screen; paginating it would
 * buy nothing and cost the reviewer the ability to sort the whole thing at
 * once. `total` goes back alongside the rows so that if the ceiling ever does
 * bite, the screen can say so instead of quietly showing a prefix.
 */

const MAX_LIMIT = 5000;

export interface ListGapKeywordsInput {
  tag: string;
  bucket?: GapKeyword["bucket"];
  status?: GapStatus;
  limit?: number;
  /** Defaults to `win` — the order a reviewer should work down. */
  sort?: GapSort;
}

export interface ListGapKeywordsOutput {
  rows: ScoredGapKeyword[];
  counts: Record<GapStatus, number>;
  /** Rows in the pile for this tag, before `limit`. */
  total: number;
}

export interface ListGapKeywords {
  execute(input: ListGapKeywordsInput): Promise<ListGapKeywordsOutput>;
}

export function createListGapKeywords(deps: {
  gaps: SeoGapRepository;
}): ListGapKeywords {
  return {
    async execute(input) {
      const requested = input.limit ?? MAX_LIMIT;
      const limit = Math.min(Math.max(1, Math.floor(requested)), MAX_LIMIT);

      const [rows, counts] = await Promise.all([
        deps.gaps.list({
          tag: input.tag,
          bucket: input.bucket,
          status: input.status,
          limit,
        }),
        deps.gaps.countByStatus({ tag: input.tag }),
      ]);

      return {
        rows: rankBy(rows, input.sort ?? "win"),
        counts,
        total: counts.new + counts.accepted + counts.rejected,
      };
    },
  };
}

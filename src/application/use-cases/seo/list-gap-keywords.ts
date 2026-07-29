import {
  rankPile,
  type GapKeyword,
  type GapStatus,
} from "@/domain/seo/gap-pile";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";

/**
 * ListGapKeywords — the read behind layer 2's review screen.
 *
 * Ranking happens here rather than in the repository so the order is a domain
 * decision (`rankPile`) testable without a database, and so a caller filtering
 * by bucket still gets the same relative ordering.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export interface ListGapKeywordsInput {
  tag: string;
  bucket?: GapKeyword["bucket"];
  status?: GapStatus;
  limit?: number;
}

export interface ListGapKeywordsOutput {
  rows: GapKeyword[];
  counts: Record<GapStatus, number>;
}

export interface ListGapKeywords {
  execute(input: ListGapKeywordsInput): Promise<ListGapKeywordsOutput>;
}

export function createListGapKeywords(deps: {
  gaps: SeoGapRepository;
}): ListGapKeywords {
  return {
    async execute(input) {
      const requested = input.limit ?? DEFAULT_LIMIT;
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

      return { rows: rankPile(rows), counts };
    },
  };
}

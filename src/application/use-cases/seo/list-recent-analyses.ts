import {
  type SeoAnalysisRepository,
  type StoredPageAnalysis,
} from "@/application/ports/seo-analysis-repository";

/**
 * ListRecentAnalyses — the read behind the admin surface's "recent runs" list.
 *
 * A `StoredPageAnalysis` is already a flat, serializable read model (primitives
 * plus the swap DTOs), so there is no entity to map — it crosses the RSC
 * boundary as-is. The one job here is clamping `limit` so a driving adapter
 * can't ask for the whole collection.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export type RecentAnalysis = StoredPageAnalysis;

export interface ListRecentAnalyses {
  execute(input?: { limit?: number }): Promise<RecentAnalysis[]>;
}

export function createListRecentAnalyses(deps: {
  analyses: SeoAnalysisRepository;
}): ListRecentAnalyses {
  return {
    async execute(input) {
      const requested = input?.limit ?? DEFAULT_LIMIT;
      const limit = Math.min(Math.max(1, Math.floor(requested)), MAX_LIMIT);
      return deps.analyses.listRecent({ limit });
    },
  };
}

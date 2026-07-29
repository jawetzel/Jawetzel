import { type IntelRun } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * ListIntelRuns — a tag's lookup history, newest first.
 *
 * The one job beyond the read is clamping `limit` so a driving adapter cannot
 * ask for the whole collection.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface ListIntelRuns {
  execute(input: { tag: string; limit?: number }): Promise<IntelRun[]>;
}

export function createListIntelRuns(deps: {
  workspace: SeoWorkspaceRepository;
}): ListIntelRuns {
  return {
    async execute(input) {
      const requested = input.limit ?? DEFAULT_LIMIT;
      const limit = Math.min(Math.max(1, Math.floor(requested)), MAX_LIMIT);
      return deps.workspace.listRuns({ tag: input.tag, limit });
    },
  };
}

import { type IntelRun } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * GetIntelRun — resume a run.
 *
 * A full funnel run costs a few dollars and spans several minutes across
 * gates, so its state lives in the database rather than in a browser tab. This
 * is the read that lets someone close the page at layer 1 and pick up at layer
 * 2 tomorrow.
 */

export interface GetIntelRun {
  execute(input: { runId: string }): Promise<IntelRun | null>;
}

export function createGetIntelRun(deps: {
  workspace: SeoWorkspaceRepository;
}): GetIntelRun {
  return {
    async execute(input) {
      return deps.workspace.findRun(input.runId);
    },
  };
}

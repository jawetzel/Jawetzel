import { ok, err, type Result } from "@/domain/shared/result";
import { hostKey } from "@/domain/seo/property-id";
import { type IntelRun } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * ApproveCompetitors — the layer-1 gate.
 *
 * Layer 2 costs roughly a dollar-fifty and runs per competitor, so nothing is
 * spent until a human has read the set and said which domains are real. seo.md
 * Part 1 already observed that the returned set is usually not who the owner
 * assumed; this is where that gets corrected before the money is spent.
 *
 * **An empty approval is a valid answer.** Someone who looks at layer 1 and
 * rejects every domain has said something meaningful, and falling back to "then
 * use them all" would spend their money against their explicit instruction.
 * Re-approving is allowed — the gate is a decision, not a one-way door.
 */

export interface ApproveCompetitorsInput {
  runId: string;
  /** Domains to carry into layer 2. May be empty. */
  domains: string[];
}

export type ApproveCompetitorsError = "RUN_NOT_FOUND" | "COMPETITORS_NOT_READY";

export interface ApproveCompetitors {
  execute(
    input: ApproveCompetitorsInput,
  ): Promise<Result<IntelRun, ApproveCompetitorsError>>;
}

export function createApproveCompetitors(deps: {
  workspace: SeoWorkspaceRepository;
  now?: () => Date;
}): ApproveCompetitors {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const run = await deps.workspace.findRun(input.runId);
      if (!run) return err("RUN_NOT_FOUND");
      if (!run.competitors) return err("COMPETITORS_NOT_READY");

      // Only domains layer 1 actually returned can be approved. An unknown one
      // is a caller bug rather than a reason to fail — drop it silently and
      // keep the run advancing.
      const observed = new Set(run.competitors.rows.map((r) => r.domain));
      const approved = [
        ...new Set(input.domains.map(hostKey).filter((d) => observed.has(d))),
      ];

      const updated: IntelRun = {
        ...run,
        status: "competitors_approved",
        approvedCompetitors: approved,
        updatedAt: now().toISOString(),
      };

      await deps.workspace.saveRun(updated);
      return ok(updated);
    },
  };
}

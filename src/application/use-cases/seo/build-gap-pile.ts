import { ok, err, isOk, type Result } from "@/domain/shared/result";
import {
  toGapRows,
  toImproveRows,
  type CompetitorGapRow,
  type GapKeyword,
} from "@/domain/seo/gap-pile";
import { effectiveCompetitors, type IntelRun } from "@/domain/seo/workspace";
import { type DomainIntersectionGateway } from "@/application/ports/domain-intersection-gateway";
import { type RankedKeywordsGateway } from "@/application/ports/ranked-keywords-gateway";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * BuildGapPile — layer 2. What the approved competitors win that we don't, plus
 * what we already rank for badly.
 *
 * Two sources, because `domain_intersection` with `intersections: false` can
 * only ever return keywords we *don't* hold. "Your content could rank better"
 * comes from the opposite direction — our own `ranked_keywords`, filtered to
 * striking distance — and it is one extra call for the highest-ROI bucket in
 * the whole design.
 *
 * **Partial failure is not total failure.** Competitor pulls run concurrently
 * and one that fails contributes nothing while the rest proceed; the response
 * reports which domains failed. At roughly a dollar-fifty a run, throwing away
 * five good pulls because the sixth timed out would be the wrong trade. Only an
 * approved set where *nothing* succeeded and we have no rankings of our own is
 * a failed layer.
 */

/** Rows to request per competitor. The vendor returns highest-volume first. */
const GAP_LIMIT_PER_COMPETITOR = 200;
/** Rows to request for our own domain, before striking-distance filtering. */
const OWN_RANKINGS_LIMIT = 500;

export interface BuildGapPileInput {
  runId: string;
}

export interface CompetitorPullReport {
  domain: string;
  rows: number;
  failed: boolean;
}

export interface BuildGapPileOutput {
  run: IntelRun;
  added: number;
  refreshed: number;
  improveRows: number;
  gapRows: number;
  competitors: CompetitorPullReport[];
  /** Sum of what the vendor reported for every call in this layer, in USD. */
  cost: number;
}

export type BuildGapPileError =
  | "RUN_NOT_FOUND"
  | "TAG_NOT_FOUND"
  | "COMPETITORS_NOT_APPROVED"
  | "NO_COMPETITORS_APPROVED"
  | "GAP_NOT_CONFIGURED"
  | "NO_GAP_DATA";

export interface BuildGapPile {
  execute(
    input: BuildGapPileInput,
  ): Promise<Result<BuildGapPileOutput, BuildGapPileError>>;
}

export function createBuildGapPile(deps: {
  workspace: SeoWorkspaceRepository;
  gaps: SeoGapRepository;
  intersection: DomainIntersectionGateway;
  rankedKeywords: RankedKeywordsGateway;
  now?: () => Date;
}): BuildGapPile {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const run = await deps.workspace.findRun(input.runId);
      if (!run) return err("RUN_NOT_FOUND");

      const approved = effectiveCompetitors(run);
      // Null means the layer-1 gate was never passed. Empty means it was passed
      // and everything was rejected — a decision, not an oversight, and one
      // that leaves layer 2 with nothing to ask about.
      if (approved === null) return err("COMPETITORS_NOT_APPROVED");
      if (approved.length === 0) return err("NO_COMPETITORS_APPROVED");

      const tag = await deps.workspace.findTag(run.tag);
      if (!tag) return err("TAG_NOT_FOUND");

      const observedAt = now().toISOString();
      const location = String(tag.locationCode);
      let cost = 0;
      let notConfigured = false;

      // ---- Our own rankings → the `improve` bucket ----
      const ownPull = await deps.rankedKeywords.fetchRankedKeywords({
        target: tag.domain,
        locationCode: tag.locationCode,
        languageCode: tag.languageCode,
        limit: OWN_RANKINGS_LIMIT,
      });

      let improveRows: GapKeyword[] = [];
      if (isOk(ownPull)) {
        cost += ownPull.value.cost;
        improveRows = toImproveRows({
          tag: tag.tag,
          location,
          rows: ownPull.value.observation.rows,
          observedAt,
        });
      } else if (ownPull.error === "NOT_CONFIGURED") {
        notConfigured = true;
      }
      // `NO_DATA` is a real answer for a property that ranks for nothing yet —
      // it is the "coverage building" mode seo.md classifies on intake, not a
      // failure. The gap half of the layer is exactly what such a property
      // needs, so we carry on.

      // ---- Competitor gaps ----
      const pulls = await Promise.all(
        approved.map(async (domain) => {
          const result = await deps.intersection.fetchGap({
            competitorDomain: domain,
            ourDomain: tag.domain,
            locationCode: tag.locationCode,
            languageCode: tag.languageCode,
            limit: GAP_LIMIT_PER_COMPETITOR,
          });
          return { domain, result };
        }),
      );

      const byCompetitor: Array<{ domain: string; rows: CompetitorGapRow[] }> =
        [];
      const reports: CompetitorPullReport[] = [];
      for (const { domain, result } of pulls) {
        if (!isOk(result)) {
          if (result.error === "NOT_CONFIGURED") notConfigured = true;
          reports.push({ domain, rows: 0, failed: true });
          continue;
        }
        cost += result.value.cost;
        byCompetitor.push({ domain, rows: result.value.rows });
        reports.push({ domain, rows: result.value.rows.length, failed: false });
      }

      if (notConfigured && byCompetitor.length === 0 && improveRows.length === 0) {
        return err("GAP_NOT_CONFIGURED");
      }

      const gapRows = toGapRows({
        tag: tag.tag,
        location,
        byCompetitor,
        observedAt,
      });

      if (gapRows.length === 0 && improveRows.length === 0) {
        return err("NO_GAP_DATA");
      }

      const { added, refreshed } = await deps.gaps.mergeAll({
        tag: tag.tag,
        observed: [...improveRows, ...gapRows],
      });

      const updated: IntelRun = {
        ...run,
        status: "gaps_ready",
        updatedAt: now().toISOString(),
      };
      await deps.workspace.saveRun(updated);

      return ok({
        run: updated,
        added,
        refreshed,
        improveRows: improveRows.length,
        gapRows: gapRows.length,
        competitors: reports,
        cost,
      });
    },
  };
}

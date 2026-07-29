import { ok, err, isOk, type Result } from "@/domain/shared/result";
import {
  normalizeKeywords,
  rankCompetitors,
  type RankedCompetitor,
} from "@/domain/seo/competitor-set";
import { type IntelRun } from "@/domain/seo/workspace";
import { type SerpCompetitorsGateway } from "@/application/ports/serp-competitors-gateway";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * StartIntelRun — layer 1. A keyword list in, the competitor set out.
 *
 * Creating the run and running layer 1 are one operation because there is no
 * gate before layer 1: the keyword list *is* the input, and a run holding a
 * keyword list and nothing else would be a state a human never wants to look
 * at. The first gate is *after* this returns — `approvedCompetitors` stays null
 * until someone reads the set and says which domains are real.
 *
 * **Failure leaves a readable run.** If the vendor call fails we still persist
 * the run in `draft` with its keyword list, and surface the error. Re-running
 * layer 1 then costs one call instead of re-typing the list, and the run
 * history records the attempt rather than silently swallowing it.
 */

/**
 * How many domains layer 1 pulls before ranking trims them. The adapter sends
 * no `order_by` — sorting is the domain's job — so this has to be generous
 * enough that the set we rank locally contains everyone who matters. 100 is the
 * vendor's own default and well inside its 1,000 ceiling.
 */
const VENDOR_LIMIT = 100;
/** Domains kept for the human to approve. More than this is a wall, not a list. */
const DEFAULT_MAX_COMPETITORS = 12;
/**
 * A domain matching fewer than a tenth of the submitted keywords is topically
 * adjacent noise, not competition. Overridable per run — a 5-keyword seed and a
 * 100-keyword one have very different distributions.
 */
const DEFAULT_MIN_SHARE = 0.1;

export interface StartIntelRunInput {
  tag: string;
  keywords: string[];
  minShare?: number;
  maxCompetitors?: number;
}

export interface StartIntelRunOutput {
  run: IntelRun;
  /** What the vendor reported layer 1 cost, in USD. */
  cost: number;
  /** Domains observed before `minShare` and the cap trimmed them. */
  observed: number;
}

export type StartIntelRunError =
  | "TAG_NOT_FOUND"
  | "NO_KEYWORDS"
  | "COMPETITORS_NOT_CONFIGURED"
  | "COMPETITORS_UNAVAILABLE";

export interface StartIntelRun {
  execute(
    input: StartIntelRunInput,
  ): Promise<Result<StartIntelRunOutput, StartIntelRunError>>;
}

export function createStartIntelRun(deps: {
  workspace: SeoWorkspaceRepository;
  competitors: SerpCompetitorsGateway;
  newId: () => string;
  now?: () => Date;
}): StartIntelRun {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const tag = await deps.workspace.findTag(input.tag);
      if (!tag) return err("TAG_NOT_FOUND");

      const keywords = normalizeKeywords(input.keywords);
      if (keywords.length === 0) return err("NO_KEYWORDS");

      const timestamp = now().toISOString();
      const base: IntelRun = {
        runId: deps.newId(),
        tag: tag.tag,
        keywords,
        locationCode: tag.locationCode,
        languageCode: tag.languageCode,
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
        competitors: null,
        approvedCompetitors: null,
      };

      const fetched = await deps.competitors.fetchCompetitors({
        keywords,
        locationCode: tag.locationCode,
        languageCode: tag.languageCode,
        limit: VENDOR_LIMIT,
      });

      if (!isOk(fetched)) {
        // Persist the attempt so the keyword list survives and re-running layer
        // 1 is one click rather than a retype.
        await deps.workspace.saveRun(base);
        return err(
          fetched.error === "NOT_CONFIGURED"
            ? "COMPETITORS_NOT_CONFIGURED"
            : "COMPETITORS_UNAVAILABLE",
        );
      }

      const ranked: RankedCompetitor[] = rankCompetitors({
        observation: fetched.value.observation,
        ourDomain: tag.domain,
        minShare: input.minShare ?? DEFAULT_MIN_SHARE,
        limit: input.maxCompetitors ?? DEFAULT_MAX_COMPETITORS,
      });

      const run: IntelRun = {
        ...base,
        status: "competitors_pending",
        updatedAt: now().toISOString(),
        competitors: {
          rows: ranked,
          capturedAt: fetched.value.observation.capturedAt,
          cost: fetched.value.cost,
          keywordCount: keywords.length,
        },
      };

      await deps.workspace.saveRun(run);
      return ok({
        run,
        cost: fetched.value.cost,
        observed: fetched.value.observation.rows.length,
      });
    },
  };
}

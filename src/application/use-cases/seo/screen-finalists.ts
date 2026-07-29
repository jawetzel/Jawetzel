import { ok, err, isOk, type Result } from "@/domain/shared/result";
import { rankPile, type GapKeyword } from "@/domain/seo/gap-pile";
import { computeSerpWeakness } from "@/domain/seo/serp-weakness";
import { type SerpGateway } from "@/application/ports/serp-gateway";
import { type KeywordMetricsGateway } from "@/application/ports/keyword-metrics-gateway";
import { type SeoCorpusRepository } from "@/application/ports/seo-corpus-repository";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * ScreenFinalists — layer 3. "Eyeball who's weak", made measurable.
 *
 * Runs over **accepted** keywords only. Layer 2 can return hundreds of rows and
 * a SERP call each would be a large, slow, mostly-wasted pull; the layer-2 gate
 * is what narrows it to the set worth observing.
 *
 * Two passes:
 *
 * 1. **Backfill metrics.** Volume, difficulty, and intent arrive attached to
 *    most layer-2 rows, but the vendor omits them per call. One batched
 *    `KeywordMetricsGateway` fan-out fills the holes — it bills one task fee
 *    for up to 1,000 keywords, so asking for forty costs the same as asking for
 *    a thousand.
 * 2. **Observe the SERP and score its softness.** Corpus-first, so a keyword
 *    already observed inside the freshness window costs nothing and re-screening
 *    after a rethink is free.
 *
 * The weakness score is a *sort order backed by visible operands*, not a
 * verdict — every fact behind it is stored so a reviewer can overrule it.
 */

/** SERP fan-out width. The vendor tolerates more; this keeps a run readable. */
const SERP_CONCURRENCY = 5;
/** Screened per invocation, so one click never becomes a five-minute request. */
const DEFAULT_MAX_FINALISTS = 40;
const MAX_FINALISTS = 200;
/** Reuse a SERP this fresh. seo.md's watchlist cadence is weekly. */
const DEFAULT_MAX_SNAPSHOT_AGE_DAYS = 7;

export interface ScreenFinalistsInput {
  tag: string;
  /** Cap on keywords screened this run. */
  limit?: number;
  /** `0` forces a fresh SERP for every finalist. */
  maxSnapshotAgeDays?: number;
  /** Re-observe keywords that already carry a screening. Default false. */
  rescreen?: boolean;
}

export interface ScreenFinalistsOutput {
  screened: number;
  skipped: number;
  failed: number;
  /** Finalists still unscreened after this run's cap. */
  remaining: number;
  fromCorpus: number;
  cost: number;
  rows: GapKeyword[];
}

export type ScreenFinalistsError =
  | "TAG_NOT_FOUND"
  | "NOTHING_ACCEPTED"
  | "SERP_NOT_CONFIGURED";

export interface ScreenFinalists {
  execute(
    input: ScreenFinalistsInput,
  ): Promise<Result<ScreenFinalistsOutput, ScreenFinalistsError>>;
}

export function createScreenFinalists(deps: {
  workspace: SeoWorkspaceRepository;
  gaps: SeoGapRepository;
  serp: SerpGateway;
  keywords: KeywordMetricsGateway;
  corpus: SeoCorpusRepository;
  now?: () => Date;
}): ScreenFinalists {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      const tag = await deps.workspace.findTag(input.tag);
      if (!tag) return err("TAG_NOT_FOUND");

      const accepted = await deps.gaps.list({
        tag: tag.tag,
        status: "accepted",
        limit: MAX_FINALISTS,
      });
      if (accepted.length === 0) return err("NOTHING_ACCEPTED");

      const cap = Math.min(
        Math.max(1, Math.floor(input.limit ?? DEFAULT_MAX_FINALISTS)),
        MAX_FINALISTS,
      );
      const maxAgeDays =
        input.maxSnapshotAgeDays ?? DEFAULT_MAX_SNAPSHOT_AGE_DAYS;

      const pending = input.rescreen
        ? accepted
        : accepted.filter((row) => row.screening === null);
      const targets = pending.slice(0, cap);
      const remaining = pending.length - targets.length;

      if (targets.length === 0) {
        return ok({
          screened: 0,
          skipped: accepted.length,
          failed: 0,
          remaining: 0,
          fromCorpus: 0,
          cost: 0,
          rows: rankPile(accepted),
        });
      }

      let cost = 0;

      // ---- 1. Backfill the metrics the layer-2 responses left null ----
      const needMetrics = targets
        .filter((row) => row.difficulty === null || row.intent === null)
        .map((row) => row.keyword);
      const metricsByKeyword = new Map<
        string,
        { difficulty: number | null; intent: string | null; volume: number | null }
      >();

      if (needMetrics.length > 0) {
        // One task fee covers up to 1,000 keywords — never trickle these.
        const metrics = await deps.keywords.fetchMetrics({
          queries: needMetrics,
          locationCode: tag.locationCode,
          languageCode: tag.languageCode,
        });
        for (const metric of metrics) {
          metricsByKeyword.set(metric.query, {
            difficulty: metric.difficulty,
            intent: metric.intent,
            volume: metric.searchVolume,
          });
        }
        if (metrics.length > 0) {
          await deps.corpus.upsertKeywordMetrics({
            location: String(tag.locationCode),
            metrics,
          });
        }
      }

      // ---- 2. Observe each SERP and score how soft it is ----
      const competitorDomains = [
        ...new Set(accepted.flatMap((row) => row.competitors.map((c) => c.domain))),
      ];
      const observedAt = now().toISOString();

      let failed = 0;
      let fromCorpus = 0;
      let notConfigured = false;

      const screened = await mapWithConcurrency(
        targets,
        SERP_CONCURRENCY,
        async (row): Promise<GapKeyword | null> => {
          const stored = await deps.corpus.findRecentSnapshot({
            query: row.keyword,
            location: String(tag.locationCode),
            maxAgeDays,
          });

          let observation = stored;
          if (!observation) {
            const fetched = await deps.serp.fetchSerp({
              query: row.keyword,
              locationCode: tag.locationCode,
              languageCode: tag.languageCode,
              depth: 10,
            });
            if (!isOk(fetched)) {
              if (fetched.error === "NOT_CONFIGURED") notConfigured = true;
              failed += 1;
              return null;
            }
            cost += fetched.value.cost;
            observation = fetched.value.observation;
            // Every observation joins the shared corpus — the flywheel in
            // seo.md Part 4c. Another caller's screening pays for ours.
            await deps.corpus.saveSnapshot(observation);
          } else {
            fromCorpus += 1;
          }

          const weakness = computeSerpWeakness({
            observation,
            query: row.keyword,
            ourDomain: tag.domain,
            competitorDomains,
          });

          const backfilled = metricsByKeyword.get(row.keyword);
          return {
            ...row,
            difficulty: row.difficulty ?? backfilled?.difficulty ?? null,
            intent: row.intent ?? backfilled?.intent ?? null,
            searchVolume: row.searchVolume ?? backfilled?.volume ?? null,
            screening: {
              capturedAt: observedAt,
              weaknessScore: weakness.score,
              facts: weakness.facts,
            },
            lastSeenAt: observedAt,
          };
        },
      );

      const updated = screened.filter((row): row is GapKeyword => row !== null);

      if (updated.length === 0 && notConfigured) {
        return err("SERP_NOT_CONFIGURED");
      }

      if (updated.length > 0) {
        await deps.gaps.mergeAll({ tag: tag.tag, observed: updated });
      }

      const rows = await deps.gaps.list({
        tag: tag.tag,
        status: "accepted",
        limit: MAX_FINALISTS,
      });

      return ok({
        screened: updated.length,
        skipped: accepted.length - pending.length,
        failed,
        remaining,
        fromCorpus,
        cost,
        rows: rankPile(rows),
      });
    },
  };
}

/**
 * Run `work` over `items`, at most `width` in flight.
 *
 * Results keep input order. A plain `Promise.all` would open forty SERP calls
 * at once — the vendor tolerates it, but the response becomes one long stall
 * with no way to reason about the tail.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  width: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, () => worker()),
  );
  return results;
}

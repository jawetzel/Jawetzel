/**
 * Ranking for suggested target queries (the "Suggest queries" helper).
 *
 * This is the ONE place an LLM-touched feature meets the deterministic side of
 * the tool, and the split is deliberate: the LLM only *proposes* candidate query
 * strings; the ranking here is a pure function of real demand data (DataForSEO
 * volume/difficulty). The LLM's guesses never enter a scored swap — a human
 * picks one candidate, and only then does the deterministic analyzer run. So the
 * advisory engine's "no LLM in the pipeline" contract holds; this is upstream
 * input-authoring help, scored by measured facts.
 *
 * The score is an explicit heuristic, not a truth: demand (log-scaled volume)
 * weighted against winnability (inverse difficulty). It exists to float the
 * best first bet to the top, and every operand is returned so a human can
 * overrule it.
 */

export interface CandidateMetric {
  query: string;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
}

export interface QueryCandidate extends CandidateMetric {
  /** 0–100 heuristic: high volume + low difficulty. Higher = better first bet. */
  score: number;
  /** True when real demand data backs it; false = an LLM guess we couldn't price. */
  grounded: boolean;
}

/** Volume at/above which the demand term saturates to 1 (log reference). */
const VOLUME_CEILING = 5000;
const WEIGHT_DEMAND = 0.6;
const WEIGHT_WINNABILITY = 0.4;

/** Log-scaled so 50→0.46 and 5,000→1 — a difference that is real but not linear. */
function demandScore(volume: number | null): number {
  if (volume === null || volume <= 0) return 0;
  return Math.min(1, Math.log10(volume + 1) / Math.log10(VOLUME_CEILING));
}

/** Unknown difficulty is neutral (0.5), never assumed easy. */
function winnabilityScore(difficulty: number | null): number {
  if (difficulty === null) return 0.5;
  return Math.max(0, Math.min(1, 1 - difficulty / 100));
}

export function rankQueryCandidates(input: {
  candidates: string[];
  metrics: CandidateMetric[];
}): QueryCandidate[] {
  const byQuery = new Map(
    input.metrics.map((m) => [m.query.trim().toLowerCase(), m]),
  );
  const seen = new Set<string>();
  const out: QueryCandidate[] = [];

  for (const rawCandidate of input.candidates) {
    const query = rawCandidate.trim();
    const key = query.toLowerCase();
    if (query === "" || seen.has(key)) continue;
    seen.add(key);

    const metric = byQuery.get(key);
    const searchVolume = metric?.searchVolume ?? null;
    const difficulty = metric?.difficulty ?? null;
    const intent = metric?.intent ?? null;
    const grounded = metric !== undefined && searchVolume !== null;

    const score = Math.round(
      100 *
        (WEIGHT_DEMAND * demandScore(searchVolume) +
          WEIGHT_WINNABILITY * winnabilityScore(difficulty)),
    );

    out.push({ query, searchVolume, difficulty, intent, score, grounded });
  }

  // Highest score first; break ties toward the easier win, then alphabetically
  // so the ordering is stable and diffable across runs.
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.difficulty ?? 100) - (b.difficulty ?? 100) ||
      a.query.localeCompare(b.query),
  );
}

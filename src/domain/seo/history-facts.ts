import { type SerpObservation } from "./serp-facts";
import { hostKey } from "./property-id";
import { phraseSet } from "./text";

/**
 * Part 4c — history as private enrichment.
 *
 * "The consumer never receives history." They receive present-tense hard values
 * that happen to be *derived* from it. `serpVolatility90d: 0.31` is as hard a
 * value as `titleLength: 38` — it simply cannot be computed by anyone who wasn't
 * recording. Provenance reports "47 observations over 14 months", never the
 * observations themselves.
 *
 * **Graceful degradation is mandatory.** Every fact here returns an explicit
 * null with an `insufficient_history` reason and its observation count when the
 * corpus is too thin. Silently substituting a global default for a missing
 * per-query value would poison the one thing this design exists to protect.
 */

export interface HistoryFact<T> {
  value: T | null;
  reason?: "insufficient_history";
  observations: number;
  required: number;
}

export interface Top10Churn {
  entered: string[];
  exited: string[];
  /** Days between the two snapshots compared. */
  spanDays: number;
}

export interface HistoryFacts {
  /** How much the top 10 churns, 0 (frozen) to 1 (fully replaced each look). */
  serpVolatility90d: HistoryFact<number>;
  /** Domains in and out since the previous observation. */
  top10Churn: HistoryFact<Top10Churn>;
  /**
   * Share of today's recommended title terms that were already recommended in
   * older snapshots — is "emergency" a 12-month norm or a 3-month shift?
   */
  termStability: HistoryFact<number>;
  /** Total snapshots in the window. Always emitted, never null. */
  observations: number;
}

const REQUIRED_FOR_VOLATILITY = 3;
const REQUIRED_FOR_CHURN = 2;
const REQUIRED_FOR_TERM_STABILITY = 6;

function insufficient<T>(observations: number, required: number): HistoryFact<T> {
  return {
    value: null,
    reason: "insufficient_history",
    observations,
    required,
  };
}

/** Top-N domains of a snapshot, deduped, in rank order. */
function topDomains(snapshot: SerpObservation, depth: number): string[] {
  const seen = new Set<string>();
  for (const result of [...snapshot.results].sort(
    (a, b) => a.position - b.position,
  )) {
    const domain = hostKey(result.domain);
    if (domain !== "") seen.add(domain);
    if (seen.size >= depth) break;
  }
  return [...seen];
}

/** Symmetric difference over union — 0 when identical, 1 when disjoint. */
function churnRate(before: string[], after: string[]): number {
  const a = new Set(before);
  const b = new Set(after);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const domain of a) if (b.has(domain)) shared += 1;
  return (union.size - shared) / union.size;
}

function daysBetween(earlier: string, later: string): number {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

export function computeHistoryFacts(input: {
  /** Snapshots for this (query, location), any order. */
  snapshots: SerpObservation[];
  /** Terms currently recommended for the title, normalized. */
  currentTitleTerms: string[];
  depth?: number;
}): HistoryFacts {
  const depth = input.depth ?? 10;
  const snapshots = [...input.snapshots].sort((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt),
  );
  const observations = snapshots.length;

  // ---- volatility: mean churn across consecutive observations ----
  let serpVolatility90d: HistoryFact<number>;
  if (observations < REQUIRED_FOR_VOLATILITY) {
    serpVolatility90d = insufficient(observations, REQUIRED_FOR_VOLATILITY);
  } else {
    const rates: number[] = [];
    for (let i = 1; i < snapshots.length; i += 1) {
      rates.push(
        churnRate(
          topDomains(snapshots[i - 1], depth),
          topDomains(snapshots[i], depth),
        ),
      );
    }
    const mean = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    serpVolatility90d = {
      value: Math.round(mean * 100) / 100,
      observations,
      required: REQUIRED_FOR_VOLATILITY,
    };
  }

  // ---- churn: who entered and exited since the previous look ----
  let top10Churn: HistoryFact<Top10Churn>;
  if (observations < REQUIRED_FOR_CHURN) {
    top10Churn = insufficient(observations, REQUIRED_FOR_CHURN);
  } else {
    const previous = snapshots[snapshots.length - 2];
    const latest = snapshots[snapshots.length - 1];
    const before = new Set(topDomains(previous, depth));
    const after = new Set(topDomains(latest, depth));
    top10Churn = {
      value: {
        entered: [...after].filter((d) => !before.has(d)).sort(),
        exited: [...before].filter((d) => !after.has(d)).sort(),
        spanDays: daysBetween(previous.capturedAt, latest.capturedAt),
      },
      observations,
      required: REQUIRED_FOR_CHURN,
    };
  }

  // ---- term stability: are today's title norms actually old news? ----
  let termStability: HistoryFact<number>;
  if (observations < REQUIRED_FOR_TERM_STABILITY || input.currentTitleTerms.length === 0) {
    termStability = insufficient(observations, REQUIRED_FOR_TERM_STABILITY);
  } else {
    // For each current term, the share of historical snapshots whose titles used
    // it at all. Averaged: 1.0 means every term is a long-standing norm.
    const perTerm = input.currentTitleTerms.map((term) => {
      const hits = snapshots.filter((snapshot) =>
        snapshot.results.some((result) => phraseSet(result.title).has(term)),
      ).length;
      return hits / observations;
    });
    const mean = perTerm.reduce((sum, s) => sum + s, 0) / perTerm.length;
    termStability = {
      value: Math.round(mean * 100) / 100,
      observations,
      required: REQUIRED_FOR_TERM_STABILITY,
    };
  }

  return { serpVolatility90d, top10Churn, termStability, observations };
}

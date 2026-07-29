import { hostKey } from "@/domain/seo/property-id";

/**
 * Layer 1 of the funnel: a keyword list in, the domains that compete across it
 * out.
 *
 * This supersedes the single-SERP heuristic in `discover-competitor-queries`,
 * which took whoever happened to occupy page one for one query. A domain that
 * outranks you on a single keyword may be an accident; a domain that appears
 * across twenty of them is the actual competition. The discriminator is
 * **`intersections`** — how many of the submitted keywords the domain ranks for
 * — and it is only computable over a *set*, which is why the funnel's entry
 * point is a keyword list rather than a URL.
 *
 * Pure: the vendor call lives behind `SerpCompetitorsGateway` and this module
 * only shapes and ranks what comes back. No vendor field name reaches here.
 */

export interface CompetitorRow {
  /** Host key — lowercase, no scheme, no leading `www.`. */
  domain: string;
  /** How many of the submitted keywords this domain ranks for. */
  intersections: number;
  /** Mean position across the keywords it ranks for. Lower is stronger. */
  avgPosition: number | null;
  /**
   * Median position across the same set. Worth carrying alongside the mean:
   * one lucky #1 drags an average down in a way the median resists, so a large
   * gap between the two is itself a signal about how evenly a domain competes.
   */
  medianPosition: number | null;
  /** Vendor's SERP visibility rate across the submitted set. */
  visibility: number | null;
  /** Vendor's estimated traffic volume across the intersecting keywords. */
  estimatedTraffic: number | null;
}

export interface CompetitorSetObservation {
  /** The keyword list this observation answers — the run's L1 input. */
  keywords: string[];
  location: string;
  capturedAt: string;
  rows: CompetitorRow[];
}

export interface RankedCompetitor extends CompetitorRow {
  /** Share of the submitted keyword set this domain ranks for, 0–1. */
  share: number;
}

export interface RankCompetitorsInput {
  observation: CompetitorSetObservation;
  /** Our own property. Excluded from its own competitor list. */
  ourDomain: string;
  /** Floor on `share` before a domain is considered competition at all. */
  minShare: number;
  limit: number;
}

/**
 * Rank the observed domains into the candidate competitor set.
 *
 * Three rules, in order of how much they matter:
 *
 * 1. **Drop ourselves.** We rank across our own keyword list by construction.
 * 2. **Drop the long tail by `share`.** A domain matching two keywords out of
 *    forty is topically adjacent noise, not a competitor. The floor is a
 *    parameter rather than a constant because a 5-keyword seed list and a
 *    100-keyword one have very different distributions.
 * 3. **Sort by coverage, then strength.** `intersections` first — breadth of
 *    overlap is the thing a single SERP could never tell us — then average
 *    position as the tiebreak, since two domains matching the same count are
 *    separated by how well they rank. Domain name breaks remaining ties so the
 *    order is stable across identical observations.
 *
 * The result is a *candidate* list. Nothing here is spent on yet — layer 2 only
 * runs against the domains a human approves at the gate.
 */
export function rankCompetitors(input: RankCompetitorsInput): RankedCompetitor[] {
  const keywordCount = input.observation.keywords.length;
  if (keywordCount === 0) return [];

  const ours = hostKey(input.ourDomain);

  return input.observation.rows
    // Normalize here rather than trusting the observation: "are you us?" is a
    // domain question, and getting it wrong puts the caller's own site at the
    // top of its competitor list. The production adapter already applies
    // `hostKey`, which makes this idempotent rather than redundant.
    .map((row) => ({ ...row, domain: hostKey(row.domain) }))
    .filter((row) => row.domain !== "" && row.domain !== ours)
    .map((row) => ({ ...row, share: row.intersections / keywordCount }))
    .filter((row) => row.share >= input.minShare)
    .sort(
      (a, b) =>
        b.intersections - a.intersections ||
        (a.avgPosition ?? Infinity) - (b.avgPosition ?? Infinity) ||
        a.domain.localeCompare(b.domain),
    )
    .slice(0, Math.max(0, input.limit));
}

/**
 * Normalize a caller's keyword list: trimmed, lowercased, de-duplicated, blanks
 * dropped, original order preserved.
 *
 * Lowercasing matters beyond tidiness — the keyword string is the join key
 * between L1's request, L2's gap pile, and the routing table that has to stay
 * stable across runs for the backlog to be computable. "Cold Hardy Trees" and
 * "cold hardy trees" arriving as two rows would silently split that history.
 */
export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const keyword = entry.trim().toLowerCase().replace(/\s+/g, " ");
    if (keyword === "" || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
  }
  return out;
}

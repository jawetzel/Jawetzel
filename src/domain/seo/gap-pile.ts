/**
 * Layer 2: the gap pile — everything worth considering for this property,
 * merged across runs.
 *
 * Two sources, two buckets, disjoint by construction:
 *
 * - **`improve`** — our own `ranked_keywords`, filtered to striking distance.
 *   We already rank; we rank badly. seo.md calls this the highest-ROI bucket,
 *   and it is the only one that arrives with a URL attached, because the vendor
 *   tells us which of our pages holds the position.
 * - **`gap`** — `domain_intersection` with `intersections: false` per approved
 *   competitor: keywords they rank for and we don't. Whether a gap belongs on
 *   an existing page (*enrich*) or needs a new one (*create*) is a judgment
 *   about a specific page, so it is not made here — layer 4 routes it against
 *   whichever page is being worked.
 *
 * **The pile is tag-scoped, not run-scoped.** Layers 1–2 answer a property-level
 * question, so their output is bought occasionally and read by every later page
 * run. That is what makes working one page at a time cheap.
 *
 * Pure. Gateways and storage live behind ports.
 */

import { type SerpWeaknessFacts } from "@/domain/seo/serp-weakness";

export type GapBucket = "improve" | "gap";

/**
 * The layer-2 gate, per keyword rather than per run.
 *
 * It has to survive a refresh: rejecting a keyword is a decision about the
 * *keyword*, and re-pulling layer 2 next quarter must not resurrect everything
 * previously thrown out. `merge` below is what enforces that.
 */
export type GapStatus = "new" | "accepted" | "rejected";

export interface CompetitorHold {
  domain: string;
  position: number;
  url: string | null;
}

/**
 * Layer 3's verdict for one keyword. Regenerable from a stored SERP, but it
 * cost a call to produce, so it survives a layer-2 refresh — see `merge`.
 */
export interface Screening {
  capturedAt: string;
  /** 0–100. Higher means the page currently ranking is softer. */
  weaknessScore: number;
  facts: SerpWeaknessFacts;
}

export interface GapKeyword {
  tag: string;
  /** Normalized. The join key for routing history — see `normalizeKeywords`. */
  keyword: string;
  location: string;
  bucket: GapBucket;
  status: GapStatus;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  /** Our position and page, for `improve` rows. Null on a gap by definition. */
  ourPosition: number | null;
  ourUrl: string | null;
  /** Which approved competitors hold this keyword, best position first. */
  competitors: CompetitorHold[];
  /** Layer 3's output. Null until this keyword has been screened. */
  screening: Screening | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Striking distance. seo.md defines it as position 5–20 with meaningful
 * impressions; with no Search Console connection there are no impressions, so
 * volume stands in. Above position 5 there is little to win and the work is
 * better spent elsewhere; past 20 it is not a near-miss, it is a gap.
 */
export const STRIKING_MIN_POSITION = 5;
export const STRIKING_MAX_POSITION = 20;

export interface OwnRankingRow {
  keyword: string;
  position: number;
  url: string | null;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
}

export interface CompetitorGapRow {
  keyword: string;
  /** The competitor's position for it. */
  position: number;
  url: string | null;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
}

export function isStrikingDistance(position: number): boolean {
  return (
    position >= STRIKING_MIN_POSITION && position <= STRIKING_MAX_POSITION
  );
}

/** Our own rankings → the `improve` bucket. */
export function toImproveRows(input: {
  tag: string;
  location: string;
  rows: OwnRankingRow[];
  observedAt: string;
}): GapKeyword[] {
  return input.rows
    .filter((row) => isStrikingDistance(row.position))
    .map((row) => ({
      tag: input.tag,
      keyword: row.keyword,
      location: input.location,
      bucket: "improve" as const,
      status: "new" as const,
      searchVolume: row.searchVolume,
      cpc: row.cpc,
      competition: row.competition,
      difficulty: row.difficulty,
      intent: row.intent,
      ourPosition: row.position,
      ourUrl: row.url,
      competitors: [],
      screening: null,
      firstSeenAt: input.observedAt,
      lastSeenAt: input.observedAt,
    }));
}

/**
 * Competitor gaps → the `gap` bucket, one row per keyword rather than per
 * (keyword, competitor).
 *
 * A keyword three competitors hold is a stronger signal than one a single site
 * won by luck, and that only becomes visible once the per-competitor rows are
 * collapsed — so the fold happens here rather than being left to the reader.
 */
export function toGapRows(input: {
  tag: string;
  location: string;
  /** Per-competitor results, keyed by the domain they came from. */
  byCompetitor: Array<{ domain: string; rows: CompetitorGapRow[] }>;
  observedAt: string;
}): GapKeyword[] {
  const merged = new Map<string, GapKeyword>();

  for (const { domain, rows } of input.byCompetitor) {
    for (const row of rows) {
      const existing = merged.get(row.keyword);
      const hold: CompetitorHold = {
        domain,
        position: row.position,
        url: row.url,
      };

      if (existing) {
        existing.competitors.push(hold);
        // Keep the richest metrics seen: the vendor omits fields per call, and
        // a null from one competitor's response should never overwrite a real
        // value from another's.
        existing.searchVolume ??= row.searchVolume;
        existing.cpc ??= row.cpc;
        existing.competition ??= row.competition;
        existing.difficulty ??= row.difficulty;
        existing.intent ??= row.intent;
        continue;
      }

      merged.set(row.keyword, {
        tag: input.tag,
        keyword: row.keyword,
        location: input.location,
        bucket: "gap",
        status: "new",
        searchVolume: row.searchVolume,
        cpc: row.cpc,
        competition: row.competition,
        difficulty: row.difficulty,
        intent: row.intent,
        ourPosition: null,
        ourUrl: null,
        competitors: [hold],
        screening: null,
        firstSeenAt: input.observedAt,
        lastSeenAt: input.observedAt,
      });
    }
  }

  for (const row of merged.values()) {
    row.competitors.sort(
      (a, b) => a.position - b.position || a.domain.localeCompare(b.domain),
    );
  }

  return [...merged.values()];
}

/**
 * Merge a freshly observed row onto whatever is already stored for that
 * keyword. **This is the rule the whole design rests on.**
 *
 * A layer-2 refresh must *update* the pile, never replace it. Replacing would
 * discard `status` — resurrecting every keyword a human already rejected —
 * reset `firstSeenAt`, which is the only record of how long something has been
 * an opportunity, and throw away `screening`, which cost a SERP call. None of
 * the three appears in a vendor response, so the merge has to be explicit.
 *
 * Facts refresh; decisions, history, and paid-for derivations persist.
 */
export function merge(stored: GapKeyword, observed: GapKeyword): GapKeyword {
  return {
    ...observed,
    // The human's decision outlives the observation that prompted it.
    status: stored.status,
    // How long this has been an opportunity is not re-derivable.
    firstSeenAt: stored.firstSeenAt,
    // Layer 3 writes through this same merge, so "keep the stored one" would
    // discard the screening it just paid for. A fresh screening wins; the
    // absence of one preserves what is already there. Re-screening stays a
    // deliberate act, never a side effect of refreshing layer 2.
    screening: observed.screening ?? stored.screening,
  };
}

/**
 * Rank the pile for review: strongest signal first.
 *
 * `improve` rows lead because we already have a page — the work is cheaper and
 * the outcome likelier than anything requiring new content. Within a bucket,
 * more competitors holding a keyword beats fewer, then higher volume, then
 * lower difficulty. Keyword breaks ties so the order is stable across runs.
 */
export function rankPile(rows: GapKeyword[]): GapKeyword[] {
  return [...rows].sort(
    (a, b) =>
      bucketRank(a.bucket) - bucketRank(b.bucket) ||
      b.competitors.length - a.competitors.length ||
      (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
      (a.difficulty ?? 101) - (b.difficulty ?? 101) ||
      a.keyword.localeCompare(b.keyword),
  );
}

function bucketRank(bucket: GapBucket): number {
  return bucket === "improve" ? 0 : 1;
}

/**
 * How the layer-2 review can be ordered.
 *
 * Two, because a reviewer asks two different questions of the same pile.
 * *Biggest win* is the one to work down; *volume* is the sanity check that the
 * scoring didn't bury something obviously large.
 */
export type GapSort = "win" | "volume";

/**
 * How big a win this keyword would be, as one comparable number.
 *
 * {@link rankPile} orders lexicographically — competitor count, *then* volume,
 * *then* difficulty — which means a keyword three sites hold at 10 searches a
 * month outranks one site holding 50,000. That is the wrong answer to "what
 * should I work on", so this trades the strict precedence for a product of
 * factors, each of which can be argued about on its own:
 *
 * - **volume** — what is actually at stake. Everything else is a discount on it,
 *   so a keyword nobody searches for cannot be a big win no matter how soft.
 * - **ease** — lower difficulty is more winnable. Unknown difficulty scores as
 *   median, not as worst: `domain_intersection` leaves it null on most gap rows
 *   (layer 3 backfills it), so treating null as hardest would bury the entire
 *   gap bucket for a reason that is about the vendor, not the keyword.
 * - **proof** — evidence it is winnable *by us*. An `improve` row proves it by
 *   the position we already hold, scaled across striking distance: at 5 we are
 *   nearly there, at 20 we are barely on the board. A `gap` row proves it by how
 *   many approved competitors hold it — one may have got lucky, four is a
 *   pattern. Saturates at four; a fifth holder says nothing new.
 * - **softness** — layer 3's weakness score, once it exists, as a ±50% swing
 *   about neutral. **An unscreened row scores neutral, never zero** — the same
 *   rule {@link rankByWinnability} states: not-yet-measured and
 *   measured-as-strong are different, and collapsing them would hide everything
 *   layer 3 hasn't reached.
 */
export function opportunityScore(row: GapKeyword): number {
  const volume = row.searchVolume ?? 0;
  if (volume <= 0) return 0;
  return volume * ease(row.difficulty) * proof(row) * softness(row.screening);
}

/** 0–1, higher is easier. Null reads as median difficulty — see above. */
function ease(difficulty: number | null): number {
  return (101 - (difficulty ?? 50)) / 101;
}

/** 0–1, higher is better-evidenced. */
function proof(row: GapKeyword): number {
  if (row.bucket === "improve") {
    const span = STRIKING_MAX_POSITION + 1 - STRIKING_MIN_POSITION;
    const position = row.ourPosition ?? STRIKING_MAX_POSITION;
    return Math.max(0, STRIKING_MAX_POSITION + 1 - position) / span;
  }
  const HOLDERS_THAT_MEAN_ANYTHING = 4;
  return (
    Math.min(row.competitors.length, HOLDERS_THAT_MEAN_ANYTHING) /
    HOLDERS_THAT_MEAN_ANYTHING
  );
}

/** 0.5–1.5, neutral at 1 while unscreened. */
function softness(screening: Screening | null): number {
  return screening === null ? 1 : (50 + screening.weaknessScore) / 100;
}

/**
 * A pile row with its score attached.
 *
 * Derived, never stored: it is a function of fields that a layer-2 refresh
 * rewrites, so persisting it would just be a copy that goes stale. It travels
 * on the read model instead — the review screen has to *show* the number it
 * sorted by, or "biggest win" is a black box the reviewer can only trust or
 * ignore, and the client cannot recompute it without reaching into the domain.
 */
export interface ScoredGapKeyword extends GapKeyword {
  opportunityScore: number;
}

/** Attach scores without touching the order. */
export function withOpportunityScore(rows: GapKeyword[]): ScoredGapKeyword[] {
  return rows.map((row) => ({ ...row, opportunityScore: opportunityScore(row) }));
}

/**
 * Order the pile for review.
 *
 * Deliberately **not** bucket-first the way {@link rankPile} is: the review
 * screen tabs by bucket, so ordering across buckets is a distinction the reader
 * never sees, and spending the primary sort key on it only costs resolution
 * within the tab they are actually looking at.
 */
export function rankBy(rows: GapKeyword[], sort: GapSort): ScoredGapKeyword[] {
  // Score once per row rather than once per comparison — the pile is the whole
  // property's working set, and a comparator is called O(n log n) times.
  const scored = withOpportunityScore(rows);

  scored.sort((a, b) =>
    sort === "volume"
      ? (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
        b.opportunityScore - a.opportunityScore ||
        a.keyword.localeCompare(b.keyword)
      : b.opportunityScore - a.opportunityScore ||
        (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
        (a.difficulty ?? 101) - (b.difficulty ?? 101) ||
        a.keyword.localeCompare(b.keyword),
  );

  return scored;
}

/**
 * Rank screened keywords by how winnable they look.
 *
 * Distinct from {@link rankPile}, which orders the layer-2 review where nothing
 * has been screened yet. Here the softness of the current page one is the whole
 * point, so it leads — then demand, then difficulty. **Unscreened rows sort
 * last regardless of volume**: an unmeasured keyword is not a weak one, and
 * floating it to the top on volume alone would be exactly the mistake layer 3
 * exists to prevent.
 */
export function rankByWinnability(rows: GapKeyword[]): GapKeyword[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.screening !== null) - Number(a.screening !== null) ||
      (b.screening?.weaknessScore ?? 0) - (a.screening?.weaknessScore ?? 0) ||
      (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
      (a.difficulty ?? 101) - (b.difficulty ?? 101) ||
      a.keyword.localeCompare(b.keyword),
  );
}

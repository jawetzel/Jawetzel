/**
 * Tunable defaults for the embroidery-supplies color search. Change these
 * in one place and every caller (page, API route, AI tool, system prompt)
 * picks up the new values.
 *
 * The neighbor gap between swatches in the "Explore nearby" row is
 * derived — always `2 * tolerance` — so adjacent neighborhoods never
 * share a match. No separate constant is needed.
 */

/** Default hex-distance radius for user-initiated searches and the AI
 *  `find_thread_color` tool. Tight by default: only visually
 *  near-identical threads. */
export const SUPPLY_DEFAULT_TOLERANCE = 12;

/** Upper clamp applied to tolerance in the AI tool so the model can
 *  widen its search on an empty result. High ceiling is fine — the
 *  tile-selection pass (`SUPPLY_TILE_MIN_SEPARATION`) spreads the 5
 *  tiles out so an over-matched search doesn't return near-duplicates. */
export const SUPPLY_MAX_TOLERANCE = 100;

/** Retry ladder the AI tool should follow when a search returns nothing.
 *  Kept here so the system prompt and the tool schema stay in sync. */
export const SUPPLY_TOLERANCE_RETRY_LADDER = [
  SUPPLY_DEFAULT_TOLERANCE,
  SUPPLY_DEFAULT_TOLERANCE * 2,
  SUPPLY_MAX_TOLERANCE,
] as const;

/** Minimum RGB distance between any two tiles shown to the chat user.
 *  Rule is `distance >= this` — spacing of exactly this value is
 *  allowed. Same distance-based dedupe methodology as the neighborhood
 *  strip, just tuned much tighter (slightly-varied options vs. distinct
 *  neighborhoods). */
export const SUPPLY_TILE_MIN_SEPARATION = 3;

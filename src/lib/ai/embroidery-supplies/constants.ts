/**
 * Tunable defaults for the embroidery-supplies color search. The definitions
 * moved to `@/domain/embroidery/supply-tolerance` — a pure domain rule, so the
 * chat use-case (`RunAssistantTurn`) can depend on them without importing
 * `@/lib`. Re-exported here so the still-flat callers (the supplies page, the
 * supply API route, the `find_thread_color` tool) keep importing from this path
 * unchanged. Change the values in the domain module; every caller picks them up.
 */
export {
  SUPPLY_DEFAULT_TOLERANCE,
  SUPPLY_MAX_TOLERANCE,
  SUPPLY_TOLERANCE_RETRY_LADDER,
  SUPPLY_TILE_MIN_SEPARATION,
} from "@/domain/embroidery/supply-tolerance";

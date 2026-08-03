import { type GapKeyword, type GapStatus } from "@/domain/seo/gap-pile";

/**
 * SeoGapRepository — layer 2's pile, keyed `(tag, keyword)`.
 *
 * **Upsert, never replace.** `seo.md`'s corpus collections are append-only
 * because observations are perishable; this one is mutable because it is a
 * *working set*. What makes it delicate is that each row carries two things the
 * vendor never sends back — the human's `status` and `firstSeenAt` — so a
 * refresh that wrote rows wholesale would resurrect every rejected keyword and
 * forget how long each opportunity had been open. `mergeAll` takes freshly
 * observed rows and is responsible for preserving both.
 *
 * The keyword is the join key. It is normalized on the way in so that the
 * routing table (`seo_routings`, designed in `seo-workspace-repository`) can
 * later attach verdicts per `(tag, pageUrl, keyword)` and the backlog stays
 * computable as set math.
 */
export interface SeoGapRepository {
  /**
   * Merge observed rows into the pile. Returns what changed, so a caller can
   * report "31 new, 402 refreshed" rather than an opaque total.
   */
  mergeAll(input: {
    tag: string;
    observed: GapKeyword[];
  }): Promise<{ added: number; refreshed: number }>;

  /**
   * **Highest `searchVolume` first**, keyword ascending to break ties.
   *
   * The order is part of the contract because `limit` is a truncation, not a
   * page: with no ordering the store is free to return an arbitrary slice, so a
   * pile larger than the limit would hand back a random subset that the caller
   * then ranks — producing a "top of the pile" assembled from rows that were
   * never compared against the ones dropped. Sorting by demand means the rows
   * that fall off the end are the least in demand, which is the only truncation
   * that can be defended without re-implementing the caller's ranking here.
   */
  list(input: {
    tag: string;
    /** Omit for every bucket. */
    bucket?: GapKeyword["bucket"];
    /** Omit for every status. */
    status?: GapStatus;
    limit: number;
  }): Promise<GapKeyword[]>;

  /** The layer-2 gate. Returns how many rows actually changed. */
  setStatus(input: {
    tag: string;
    keywords: string[];
    status: GapStatus;
  }): Promise<number>;

  countByStatus(input: {
    tag: string;
  }): Promise<Record<GapStatus, number>>;
}

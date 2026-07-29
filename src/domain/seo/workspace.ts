import { type RankedCompetitor } from "@/domain/seo/competitor-set";

/**
 * The workspace domain — customer tags and the intel runs that hang off them.
 *
 * **The scope seam this encodes.** `serp_competitors` and `domain_intersection`
 * both work domain-to-domain, so layers 1–2 are *property*-scoped: the
 * competitor set and the gap pile are the same no matter which page is being
 * worked. Layers 3–4 are *page*-scoped. An `IntelRun` is therefore one L1/L2
 * refresh for a property, paid for occasionally, and every page run afterwards
 * reads it for free. That is what makes working one page at a time cheap.
 *
 * **Why the tag is not just the domain.** A tag names the engagement, the domain
 * names the property. Keeping them separate means the run history has a stable
 * key even if a property moves host, and it leaves room for a caller who runs
 * two engagements against one domain.
 *
 * Pure types and invariants. No I/O.
 */

/** Where an intel run has got to. The gate between each pair is a human. */
export type IntelRunStatus =
  /** Created, keyword list recorded, layer 1 not yet run. */
  | "draft"
  /** Layer 1 returned; the competitor set is awaiting approval. */
  | "competitors_pending"
  /** Competitors approved; layer 2 may run. */
  | "competitors_approved"
  /**
   * Layer 2 has merged into the tag's gap pile. The run's own job ends here —
   * the pile is tag-scoped and reviewed there, not per run, because rejecting a
   * keyword is a decision about the keyword and must outlive the run that
   * surfaced it.
   */
  | "gaps_ready";

export interface SeoTag {
  /** URL-safe slug, unique. The customer tag. */
  tag: string;
  /** Human label for the picker. */
  label: string;
  /** Host key of the property this tag pertains to. */
  domain: string;
  locationCode: number;
  languageCode: string;
  /** seo.md §2's load-bearing field — the fact types a page here should state. */
  entitySchema: string[];
  urgencyTerms: string[];
  city: string | null;
  createdAt: string;
}

export interface CompetitorStage {
  /** What the vendor observed, already ranked and trimmed. */
  rows: RankedCompetitor[];
  capturedAt: string;
  /** What the vendor reported this stage cost, in USD. Never derived. */
  cost: number;
  /** Echoed so a reader can re-derive `share` without the run's input. */
  keywordCount: number;
}

export interface IntelRun {
  runId: string;
  tag: string;
  /** Normalized L1 input — the join key for everything downstream. */
  keywords: string[];
  locationCode: number;
  languageCode: string;
  status: IntelRunStatus;
  createdAt: string;
  updatedAt: string;
  competitors: CompetitorStage | null;
  /** The layer-1 gate. Null until a human has approved; may be empty. */
  approvedCompetitors: string[] | null;
}

/** Slug rule for a tag: lowercase alphanumerics and single hyphens. */
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidTag(tag: string): boolean {
  return tag.length >= 2 && tag.length <= 64 && TAG_PATTERN.test(tag);
}

/**
 * Coerce a label into a tag slug. Used to offer a default at intake; the caller
 * may always supply their own.
 */
export function toTagSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Which competitor domains layer 2 should actually run against.
 *
 * Approval is explicit and may legitimately be empty — a human who looks at the
 * layer-1 output and rejects everything has said something meaningful, and we
 * must not silently fall back to "then use them all" and spend their money.
 * Before approval there is no answer, which is why the return is nullable
 * rather than an empty array.
 */
export function effectiveCompetitors(run: IntelRun): string[] | null {
  if (run.approvedCompetitors === null) return null;
  const observed = new Set((run.competitors?.rows ?? []).map((r) => r.domain));
  // An approval naming a domain layer 1 never returned is a caller bug, not a
  // reason to fail the run — drop it and proceed with what was observed.
  return run.approvedCompetitors.filter((domain) => observed.has(domain));
}

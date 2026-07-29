import { type GapKeyword } from "@/domain/seo/gap-pile";

/**
 * Layer 4a: routing the pile against **one page**.
 *
 * Three verdicts, and the discriminator is the page in front of us:
 *
 * | | Condition | The work |
 * |---|---|---|
 * | `improve` | We rank for it *with this page*, badly | Fix this page |
 * | `enrich`  | On-topic for this page, but it never says it | Work the terms in |
 * | `create`  | Off-topic for this page | Belongs elsewhere |
 *
 * **`create` means "not this page", not "you have no page for this."** We only
 * look at one page, so the stronger claim would be unfounded. What makes it
 * useful anyway is accumulation: run twenty pages and the keywords no page ever
 * claimed are, by construction, the property's real coverage gaps. That residue
 * is the backlog, and it is set math over stored routings — which is why every
 * verdict has to be durable from the first run rather than reconstructed later.
 *
 * **Only `enrich` vs `create` needs judgment.** An `improve` row arrives with a
 * URL the vendor gave us; if it is this page, the answer is already known and no
 * model is asked. Topical proximity is the one question frequency analysis does
 * badly — "cold hardy trees" against a page titled *Winter Garden Prep* shares
 * almost no n-grams and is obviously the same subject.
 *
 * Pure. The model call and storage live behind ports.
 */

export type RouteVerdict = "improve" | "enrich" | "create";

export interface Routing {
  tag: string;
  /** The page this verdict is about. Normalized, so the key stays stable. */
  pageUrl: string;
  keyword: string;
  verdict: RouteVerdict;
  /** The model's one-clause reason. Displayed, never scored. */
  rationale: string | null;
  /** True once a human has changed the verdict. Survives re-routing. */
  overridden: boolean;
  routedAt: string;
}

/**
 * Canonical form of a page URL for keying.
 *
 * Trailing slashes, the fragment, and tracking parameters all describe the same
 * page, and letting them through would split one page's routing history across
 * several keys — which silently breaks the backlog.
 */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export interface PreRouted {
  /** Decided without asking a model — we already know we rank with this page. */
  decided: Array<{ keyword: string; verdict: RouteVerdict }>;
  /** Needs the topical judgment: enrich or create. */
  needsJudgment: GapKeyword[];
  /**
   * `improve` rows belonging to a *different* page of ours. Excluded rather
   * than routed: a keyword another page already owns is not a candidate for
   * this one, and claiming it here would let one page's run silently absorb
   * work that belongs to another.
   */
  ownedElsewhere: number;
}

/**
 * Split the candidate set before any model is involved.
 *
 * Everything decidable from measured facts is decided here; only what genuinely
 * requires judgment is sent on. That keeps the model's surface small, the token
 * cost proportional to the real question, and every deterministic answer
 * deterministic.
 */
export function preRoute(input: {
  pageUrl: string;
  rows: GapKeyword[];
}): PreRouted {
  const page = pageKey(input.pageUrl);
  const decided: PreRouted["decided"] = [];
  const needsJudgment: GapKeyword[] = [];
  let ownedElsewhere = 0;

  for (const row of input.rows) {
    if (row.bucket === "improve") {
      if (row.ourUrl && pageKey(row.ourUrl) === page) {
        decided.push({ keyword: row.keyword, verdict: "improve" });
      } else {
        ownedElsewhere += 1;
      }
      continue;
    }
    needsJudgment.push(row);
  }

  return { decided, needsJudgment, ownedElsewhere };
}

/** One verdict as the model returned it, before validation. */
export interface RawVerdict {
  keyword: string;
  verdict: string;
  why?: string | null;
}

/**
 * Validate the model's verdicts against the keywords it was actually asked
 * about.
 *
 * Three rules, all of them defences against a chatty or creative model:
 * invented keywords are dropped, unknown verdicts are dropped, and anything the
 * model failed to mention **defaults to `create`**. That default is the
 * conservative one — `create` parks a keyword in the backlog for later, while
 * `enrich` would assert the page should cover something nobody judged.
 */
export function reconcileVerdicts(input: {
  asked: string[];
  returned: RawVerdict[];
}): Array<{ keyword: string; verdict: RouteVerdict; rationale: string | null }> {
  const askedSet = new Set(input.asked);
  const byKeyword = new Map<
    string,
    { verdict: RouteVerdict; rationale: string | null }
  >();

  for (const raw of input.returned) {
    const keyword = typeof raw.keyword === "string" ? raw.keyword.trim().toLowerCase() : "";
    if (!askedSet.has(keyword) || byKeyword.has(keyword)) continue;
    const verdict = raw.verdict === "enrich" ? "enrich" : raw.verdict === "create" ? "create" : null;
    if (!verdict) continue;
    byKeyword.set(keyword, {
      verdict,
      rationale:
        typeof raw.why === "string" && raw.why.trim() !== ""
          ? raw.why.trim()
          : null,
    });
  }

  return input.asked.map((keyword) => {
    const decided = byKeyword.get(keyword);
    return {
      keyword,
      verdict: decided?.verdict ?? "create",
      rationale: decided?.rationale ?? null,
    };
  });
}

/**
 * The backlog: accepted keywords **no page run has ever claimed**.
 *
 * "Claimed" means routed `improve` or `enrich` by any page — those have a home.
 * A `create` verdict is explicitly *not* a claim; it is one page declining the
 * keyword, which is the whole reason the residue only becomes meaningful once
 * several pages have been run.
 */
export function computeBacklog(input: {
  accepted: GapKeyword[];
  routings: Routing[];
}): GapKeyword[] {
  const claimed = new Set(
    input.routings
      .filter((r) => r.verdict === "improve" || r.verdict === "enrich")
      .map((r) => r.keyword),
  );
  return input.accepted.filter((row) => !claimed.has(row.keyword));
}

/**
 * How much of the property has actually been looked at.
 *
 * The backlog is only trustworthy in proportion to this. After three pages the
 * residue is mostly "we haven't looked yet"; after twenty it is a finding.
 * Reporting the number alongside the list is what keeps an early backlog from
 * reading as a confident recommendation.
 */
export function backlogCoverage(routings: Routing[]): {
  pagesRouted: number;
  keywordsClaimed: number;
} {
  return {
    pagesRouted: new Set(routings.map((r) => r.pageUrl)).size,
    keywordsClaimed: new Set(
      routings
        .filter((r) => r.verdict === "improve" || r.verdict === "enrich")
        .map((r) => r.keyword),
    ).size,
  };
}

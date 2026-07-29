"use client";

import { useState } from "react";
import { Loader2, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BacklogResponse } from "../../_components/workspace-types";

/**
 * The backlog — accepted keywords no page run has ever claimed.
 *
 * The long-game output, and the reason routing verdicts are stored per
 * `(tag, pageUrl, keyword)` from the first run. One page's `create` says almost
 * nothing; after twenty pages the residue is the property's real coverage gap,
 * found without ever crawling the site.
 *
 * **The coverage figure is not decoration.** After three pages this list is
 * mostly "we haven't looked yet", and presenting it as a finding would be the
 * same dishonesty as inventing a number for something never measured. It leads,
 * and it is stated in the list's own words rather than hidden in a tooltip.
 */

/** Below this, the residue is ignorance rather than a finding. Say so plainly. */
const TRUSTWORTHY_PAGE_COUNT = 10;

export function Backlog({ tag }: { tag: string }) {
  const [data, setData] = useState<BacklogResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/seo/tags/${encodeURIComponent(tag)}/backlog`,
      );
      if (res.ok) setData((await res.json()) as BacklogResponse);
    } finally {
      setLoading(false);
    }
  }

  const thin =
    data !== null && data.coverage.pagesRouted < TRUSTWORTHY_PAGE_COUNT;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">
          <span className="font-mono text-sm text-[var(--color-text-muted)]">
            Backlog ·{" "}
          </span>
          Nothing you&apos;ve run covers these
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </>
          ) : (
            <>
              <MapIcon size={14} /> {data ? "Refresh" : "Show backlog"}
            </>
          )}
        </Button>
      </div>

      {data && (
        <>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium text-[var(--color-text-primary)]">
              {data.rows.length} unclaimed
            </span>{" "}
            of {data.coverage.keywordsAccepted} accepted, across{" "}
            {data.coverage.pagesRouted}{" "}
            {data.coverage.pagesRouted === 1 ? "page" : "pages"} routed.
          </p>

          {thin && (
            <p className="mt-2 rounded-xl bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]">
              With only {data.coverage.pagesRouted}{" "}
              {data.coverage.pagesRouted === 1 ? "page" : "pages"} routed, most
              of this is &ldquo;not looked at yet&rdquo; rather than &ldquo;no
              page covers it&rdquo;. Route more pages before treating it as a
              content plan.
            </p>
          )}

          {data.rows.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--color-border)]">
              {data.rows.slice(0, 50).map((row) => (
                <li
                  key={row.keyword}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
                >
                  <span className="font-mono text-[var(--color-brand-primary-dark)]">
                    {row.keyword}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {row.searchVolume === null
                      ? "vol —"
                      : `vol ${row.searchVolume.toLocaleString("en-US")}`}
                  </span>
                  {row.screening && (
                    <Badge tone="neutral">
                      weak {row.screening.weaknessScore}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                    {row.competitors.length > 0 &&
                      `${row.competitors.length} competitor${row.competitors.length === 1 ? "" : "s"}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

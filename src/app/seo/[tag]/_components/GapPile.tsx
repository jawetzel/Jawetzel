"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Gauge,
  Layers,
  Loader2,
  Play,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGapPile } from "./useGapPile";
import type {
  BuildGapPileResponse,
  GapBucketView,
  GapKeywordView,
  GapPileResponse,
  GapSortView,
  GapStatusView,
  IntelRunView,
  ScreeningView,
  ScreenResponse,
} from "../../_components/workspace-types";

/**
 * Layer 2 — the gap pile and its gate.
 *
 * Two buckets, shown as tabs because they answer different questions:
 *
 * - **Improve** — we rank, badly. Comes with the URL attached, so the work is
 *   "fix this page" and nothing has to be decided about where it belongs.
 * - **Gap** — competitors win it, we don't rank at all. Whether it belongs on
 *   an existing page or a new one is a judgment about a *specific* page, made
 *   at layer 4 against whichever page is being worked. Not here.
 *
 * The gate is per keyword, not per run: rejecting something is a decision about
 * the keyword, and re-pulling layer 2 next quarter must not resurrect it.
 */

const BUCKET_LABEL: Record<GapBucketView, string> = {
  improve: "Improve",
  gap: "Gap",
};

const BUCKET_HINT: Record<GapBucketView, string> = {
  improve: "You rank for these, but poorly. Cheapest wins — the page exists.",
  gap: "Competitors win these, you don't rank. Layer 4 decides where each belongs.",
};

const SORT_LABEL: Record<GapSortView, string> = {
  win: "Biggest win",
  volume: "Volume",
};

const SORT_HINT: Record<GapSortView, string> = {
  win: "Volume discounted by difficulty, by how much evidence there is that you can take it, and — once layer 3 has run — by how soft the incumbent is.",
  volume: "Raw monthly searches. The check that the scoring hasn't buried something obviously large.",
};

export function GapPile({
  tag,
  run,
  initialPile,
  onRunAdvanced,
}: {
  tag: string;
  /** The run layer 2 hangs off — must have passed the layer-1 gate. */
  run: IntelRunView | null;
  initialPile: GapPileResponse | null;
  onRunAdvanced?: (run: BuildGapPileResponse["run"]) => void;
}) {
  const { state, build, screen, setStatus } = useGapPile({
    tag,
    initialPile,
    onRunAdvanced,
  });
  const [bucket, setBucket] = useState<GapBucketView>("improve");
  const [sort, setSort] = useState<GapSortView>("win");
  const [showRejected, setShowRejected] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const gateOpen =
    run !== null &&
    run.approvedCompetitors !== null &&
    run.approvedCompetitors.length > 0;

  /**
   * Sorting is client-side because the whole pile is already here — the server
   * ranks it once for the initial paint, and re-ordering a thousand rows the
   * browser is holding is not worth a round trip. The score itself still comes
   * from the server, so this reorders by the same number the table prints.
   */
  const visible = useMemo(() => {
    const rows = state.rows.filter(
      (row) =>
        row.bucket === bucket && (showRejected || row.status !== "rejected"),
    );
    return rows.sort((a, b) =>
      sort === "volume"
        ? (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
          b.opportunityScore - a.opportunityScore ||
          a.keyword.localeCompare(b.keyword)
        : b.opportunityScore - a.opportunityScore ||
          (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
          a.keyword.localeCompare(b.keyword),
    );
  }, [state.rows, bucket, showRejected, sort]);

  /**
   * What each tab will actually show, so the toggle visibly moves them.
   * These used to always exclude rejected rows while the pile itself was capped
   * at 200 — between the two, checking "show rejected" could leave every number
   * and every row on screen unchanged, which read as a dead control.
   */
  const bucketCounts = useMemo(() => {
    const counts: Record<GapBucketView, number> = { improve: 0, gap: 0 };
    for (const row of state.rows) {
      if (showRejected || row.status !== "rejected") counts[row.bucket] += 1;
    }
    return counts;
  }, [state.rows, showRejected]);

  const hiddenRejected = useMemo(
    () =>
      state.rows.filter(
        (row) => row.bucket === bucket && row.status === "rejected",
      ).length,
    [state.rows, bucket],
  );

  /** The read is capped; if it ever bites, say so rather than showing a prefix. */
  const truncated = Math.max(0, state.total - state.rows.length);

  const busy =
    state.phase === "building" ||
    state.phase === "saving" ||
    state.phase === "screening";
  const unscreenedAccepted = state.rows.filter(
    (r) => r.status === "accepted" && r.screening === null,
  ).length;

  /** Membership, not a scan — `visible` is the whole bucket, not a page of it. */
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /** Stable, so `GapRow`'s memo actually holds across a tick. */
  const toggle = useCallback((keyword: string) => {
    setSelected((prev) =>
      prev.includes(keyword)
        ? prev.filter((k) => k !== keyword)
        : [...prev, keyword],
    );
  }, []);

  function apply(status: GapStatusView) {
    void setStatus(selected, status);
    setSelected([]);
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">
          <span className="font-mono text-sm text-[var(--color-text-muted)]">
            L2 ·{" "}
          </span>
          What they win that you don&apos;t
        </h2>
        <Button
          type="button"
          variant={state.rows.length > 0 ? "outline" : "primary"}
          disabled={!gateOpen || busy}
          onClick={() => run && void build(run.runId)}
        >
          {state.phase === "building" ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Pulling gaps…
            </>
          ) : state.rows.length > 0 ? (
            <>
              <Layers size={16} /> Refresh pile
            </>
          ) : (
            <>
              Run layer 2 <Play size={16} />
            </>
          )}
        </Button>
      </div>

      {!gateOpen && (
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          {run === null
            ? "Run layer 1 first."
            : run.approvedCompetitors === null
              ? "Approve the competitor set above, then layer 2 can run."
              : "Every competitor was rejected, so there is nothing to compare against."}
        </p>
      )}

      {gateOpen && state.rows.length === 0 && state.phase !== "building" && (
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          One call per approved competitor plus one for your own rankings —{" "}
          {run.approvedCompetitors?.length ?? 0} domains, so roughly $
          {(((run.approvedCompetitors?.length ?? 0) + 1) * 0.15).toFixed(2)}.
          This is the expensive layer.
        </p>
      )}

      {state.lastBuild && <BuildReport report={state.lastBuild} />}
      {state.lastScreen && <ScreenReport report={state.lastScreen} />}

      {state.error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-3 text-sm">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
          />
          <p className="text-[var(--color-status-error)]">{state.error}</p>
        </div>
      )}

      {state.rows.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-[var(--color-border-strong)] p-1 text-sm">
              {(["improve", "gap"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => {
                    setBucket(b);
                    setSelected([]);
                  }}
                  className={`rounded-full px-4 py-1.5 font-medium transition ${
                    bucket === b
                      ? "bg-[var(--color-brand-primary-deep)] text-[var(--color-text-inverse)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  {BUCKET_LABEL[b]} ({bucketCounts[b]})
                </button>
              ))}
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span>Sort</span>
              <div className="inline-flex rounded-full border border-[var(--color-border-strong)] p-0.5">
                {(["win", "volume"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    title={SORT_HINT[s]}
                    onClick={() => setSort(s)}
                    className={`rounded-full px-3 py-1 font-medium transition ${
                      sort === s
                        ? "bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]"
                        : "hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    {SORT_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={showRejected}
                onChange={() => setShowRejected((v) => !v)}
              />
              show rejected
              {hiddenRejected > 0 && !showRejected && ` (${hiddenRejected})`}
            </label>

            <span className="ml-auto text-xs text-[var(--color-text-muted)]">
              {state.counts.accepted} accepted · {state.counts.new} undecided ·{" "}
              {state.counts.rejected} rejected
            </span>
          </div>

          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {BUCKET_HINT[bucket]}
          </p>

          {truncated > 0 && (
            <p className="mt-2 text-xs text-[var(--color-status-error)]">
              Showing {state.rows.length.toLocaleString("en-US")} of{" "}
              {state.total.toLocaleString("en-US")} — {truncated.toLocaleString("en-US")}{" "}
              lowest-volume rows were left on the server.
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="w-8 py-2" />
                  <th className="py-2 pr-3 font-medium">Keyword</th>
                  <th className="py-2 pr-3 font-medium" title={SORT_HINT.win}>
                    Win
                  </th>
                  <th className="py-2 pr-3 font-medium">Vol</th>
                  <th className="py-2 pr-3 font-medium">Diff</th>
                  <th className="py-2 pr-3 font-medium" title="How soft the page currently ranking is. Higher is more winnable.">
                    Weak
                  </th>
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">
                    {bucket === "improve" ? "Your position" : "Who wins it"}
                  </th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {visible.map((row) => (
                  <GapRow
                    key={row.keyword}
                    row={row}
                    checked={selectedSet.has(row.keyword)}
                    disabled={busy}
                    onToggle={toggle}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setSelected(visible.map((r) => r.keyword))}
                className="font-medium text-[var(--color-brand-primary-dark)] hover:underline"
              >
                Select all {visible.length}
              </button>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="font-medium text-[var(--color-brand-primary-dark)] hover:underline"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selected.length === 0 || busy}
                onClick={() => apply("rejected")}
              >
                <X size={14} /> Reject {selected.length || ""}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={selected.length === 0 || busy}
                onClick={() => apply("accepted")}
              >
                <Check size={14} /> Accept {selected.length || ""}
              </Button>
            </div>
          </div>

          {/* ---- Layer 3 ---- */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-muted)] p-4">
            <div className="text-sm">
              <p className="font-medium">
                <span className="font-mono text-xs text-[var(--color-text-muted)]">
                  L3 ·{" "}
                </span>
                Score how weak the incumbents are
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {state.counts.accepted === 0
                  ? "Accept some keywords above first."
                  : unscreenedAccepted === 0
                    ? `All ${state.counts.accepted} accepted keywords are screened.`
                    : `${unscreenedAccepted} accepted, unscreened. One SERP each (~$0.002), reused from the corpus where fresh.`}
              </p>
            </div>
            <Button
              type="button"
              variant={unscreenedAccepted > 0 ? "primary" : "outline"}
              size="sm"
              disabled={state.counts.accepted === 0 || busy}
              onClick={() =>
                void screen({ rescreen: unscreenedAccepted === 0 })
              }
            >
              {state.phase === "screening" ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Screening…
                </>
              ) : unscreenedAccepted > 0 ? (
                <>
                  <Gauge size={14} /> Screen {unscreenedAccepted}
                </>
              ) : (
                <>
                  <Gauge size={14} /> Re-screen
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function BuildReport({ report }: { report: BuildGapPileResponse }) {
  const failed = report.competitors.filter((c) => c.failed);
  return (
    <div className="mt-4 rounded-xl bg-[var(--color-surface-muted)] p-4 text-sm">
      <p className="text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text-primary)]">
          {report.added} new
        </span>{" "}
        · {report.refreshed} refreshed · {report.improveRows} improve ·{" "}
        {report.gapRows} gap · ${report.cost.toFixed(2)}
      </p>
      {failed.length > 0 && (
        <p className="mt-1 text-xs text-[var(--color-status-error)]">
          {failed.map((c) => c.domain).join(", ")} failed — the rest of the pull
          still landed.
        </p>
      )}
    </div>
  );
}

function ScreenReport({ report }: { report: ScreenResponse }) {
  return (
    <div className="mt-4 rounded-xl bg-[var(--color-surface-muted)] p-4 text-sm">
      <p className="text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text-primary)]">
          {report.screened} screened
        </span>
        {report.fromCorpus > 0 && ` · ${report.fromCorpus} free from corpus`}
        {report.skipped > 0 && ` · ${report.skipped} already done`}
        {report.failed > 0 && ` · ${report.failed} failed`} · $
        {report.cost.toFixed(3)}
      </p>
      {report.remaining > 0 && (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {report.remaining} still unscreened — this run was capped. Screen
          again to continue.
        </p>
      )}
    </div>
  );
}

/**
 * Memoized: the pile is the property's whole working set, so a table of a
 * thousand rows is normal here and every checkbox tick would otherwise re-render
 * all of them. The parent has to hand it a stable `onToggle` for this to hold.
 */
const GapRow = memo(function GapRow({
  row,
  checked,
  disabled,
  onToggle,
}: {
  row: GapKeywordView;
  checked: boolean;
  disabled: boolean;
  onToggle: (keyword: string) => void;
}) {
  return (
    <tr className={row.status === "rejected" ? "opacity-40" : ""}>
      <td className="py-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(row.keyword)}
          aria-label={`Select ${row.keyword}`}
        />
      </td>
      <td className="py-2.5 pr-3 font-mono text-[var(--color-brand-primary-dark)]">
        {row.keyword}
      </td>
      <td className="py-2.5 pr-3 tabular-nums">
        {row.opportunityScore > 0
          ? Math.round(row.opportunityScore).toLocaleString("en-US")
          : "—"}
      </td>
      <td className="py-2.5 pr-3 tabular-nums">
        {row.searchVolume === null
          ? "—"
          : row.searchVolume.toLocaleString("en-US")}
      </td>
      <td className="py-2.5 pr-3">{row.difficulty ?? "—"}</td>
      <td className="py-2.5 pr-3">
        <WeaknessCell screening={row.screening} />
      </td>
      <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">
        {row.intent ?? "—"}
      </td>
      <td className="py-2.5 pr-3 text-xs text-[var(--color-text-secondary)]">
        {row.bucket === "improve" ? (
          <>
            #{row.ourPosition}
            {row.ourUrl && (
              <span className="ml-2 text-[var(--color-text-muted)]">
                {shortPath(row.ourUrl)}
              </span>
            )}
          </>
        ) : (
          row.competitors
            .map((c) => `${c.domain} #${c.position}`)
            .slice(0, 3)
            .join(" · ") || "—"
        )}
      </td>
      <td className="py-2.5">
        {row.status === "accepted" ? (
          <Badge tone="brand">accepted</Badge>
        ) : row.status === "rejected" ? (
          <Badge tone="neutral">rejected</Badge>
        ) : (
          <Badge tone="warm">new</Badge>
        )}
      </td>
    </tr>
  );
});

/**
 * The weakness score, with its operands in the tooltip.
 *
 * An unscreened row shows an em dash, never a zero: not-yet-measured and
 * measured-as-strong are different states, and conflating them would hide
 * everything layer 3 hasn't reached yet.
 */
function WeaknessCell({ screening }: { screening: ScreeningView | null }) {
  if (!screening) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const { weaknessScore: score, facts } = screening;
  const tone = score >= 60 ? "brand" : score >= 30 ? "warm" : "neutral";
  const detail = [
    `${facts.ugcResults}/${facts.resultCount} forum or UGC`,
    `${facts.directoryResults}/${facts.resultCount} directory`,
    `${Math.round(facts.titleTermCoverage * 100)}% of titles on-target`,
    facts.features.length > 0 ? facts.features.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span title={detail}>
      <Badge tone={tone}>{score}</Badge>
    </span>
  );
}

/** Just the path — the domain is the same on every row in this bucket. */
function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useIntelRun } from "./useIntelRun";
import { GapPile } from "./GapPile";
import { PageRun } from "./PageRun";
import { Backlog } from "./Backlog";
import type {
  CompetitorRowView,
  GapPileResponse,
  IntelRunView,
  SeoTagView,
} from "../../_components/workspace-types";

/**
 * The tag workspace — layer 1 and its gate.
 *
 * Three zones, in the order the funnel runs them: the keyword box, the
 * competitor table, and the run history. Layers 2–4 land underneath as they are
 * built; the ladder is meant to grow downward, not to be rearranged.
 *
 * **The table is the point.** Layer 1 is one cheap call and layer 2 costs
 * roughly a dollar-fifty *per approved competitor*, so the value of this screen
 * is that someone looks at the set before the money is spent. seo.md observed
 * that the returned competitors are usually not who the owner assumed — this is
 * where that gets corrected.
 */

export function Workspace({
  tag,
  initialRuns,
  initialPile,
}: {
  tag: SeoTagView;
  initialRuns: IntelRunView[];
  initialPile: GapPileResponse | null;
}) {
  const [runs, setRuns] = useState<IntelRunView[]>(initialRuns);
  const { state, start, approve, open, reset } = useIntelRun({
    tag: tag.tag,
    // Resume the newest run rather than opening cold — the run is the thing
    // that survives a refresh, so the page should behave like it.
    initialRun: initialRuns[0] ?? null,
    onRunChanged: (run) =>
      setRuns((prev) => [run, ...prev.filter((r) => r.runId !== run.runId)]),
  });

  const [keywords, setKeywords] = useState("");

  // Layer 4's panel shows volume and weakness next to each verdict; the pile
  // already holds both, so it is threaded down rather than re-fetched.
  const acceptedCount =
    initialPile?.rows.filter((r) => r.status === "accepted").length ?? 0;
  const rowsByKeyword = new Map(
    (initialPile?.rows ?? []).map((row) => [row.keyword, row]),
  );

  const busy = state.phase === "running" || state.phase === "approving";

  return (
    <div className="space-y-8">
      {/* ---- Layer 1 input ---- */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start(keywords);
        }}
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold">
            <span className="font-mono text-sm text-[var(--color-text-muted)]">
              L1 ·{" "}
            </span>
            Who competes for these?
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            One call, a few cents. Nothing expensive runs until you approve.
          </p>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="keywords">
            Keywords{" "}
            <span className="text-[var(--color-text-muted)]">
              (one per line, or comma-separated — up to 200)
            </span>
          </Label>
          <Textarea
            id="keywords"
            rows={6}
            className="font-mono text-sm"
            placeholder={"cold hardy trees\nzone 3 trees\nwinter hardy shrubs"}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            required
          />
          <p className="text-xs text-[var(--color-text-muted)]">
            The set is what defines the competition — a domain that beats you on
            one keyword may be an accident; one that appears across twenty is the
            real thing.
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="submit" variant="primary" disabled={busy}>
            {state.phase === "running" ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Finding
                competitors…
              </>
            ) : (
              <>
                Run layer 1 <Play size={16} />
              </>
            )}
          </Button>
        </div>
      </form>

      {state.phase === "error" && state.error && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-4 text-sm">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
          />
          <div>
            <p className="font-medium text-[var(--color-status-error)]">
              {state.error}
            </p>
            {state.fieldErrors.length > 0 && (
              <ul className="mt-2 space-y-1 text-[var(--color-text-secondary)]">
                {state.fieldErrors.map((f) => (
                  <li key={f.field}>
                    <span className="font-mono">{f.field}</span>: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---- Layer 1 output + gate ---- */}
      {state.run && (
        <CompetitorGate
          // Remount when the run — or its verdict — changes, so the checkbox
          // selection re-seeds from `useState` rather than from an effect that
          // would cascade a second render on every approval.
          key={`${state.run.runId}:${
            state.run.approvedCompetitors?.join(",") ?? "pending"
          }`}
          run={state.run}
          observed={state.observed}
          busy={state.phase === "approving"}
          onApprove={approve}
        />
      )}

      {/* ---- Layer 2: the gap pile and its gate. Layer 3 lives inside it. ---- */}
      <GapPile
        tag={tag.tag}
        run={state.run}
        initialPile={initialPile}
        onRunAdvanced={(run) =>
          setRuns((prev) => [
            run,
            ...prev.filter((r) => r.runId !== run.runId),
          ])
        }
      />

      {/* ---- Layer 4a: route the pile against one page ---- */}
      <PageRun
        tag={tag.tag}
        acceptedCount={acceptedCount}
        rowsByKeyword={rowsByKeyword}
      />

      {/* ---- The residue, once enough pages have been routed to mean anything ---- */}
      <Backlog tag={tag.tag} />

      {/* ---- History ---- */}
      {runs.length > 0 && (
        <RunHistory
          runs={runs}
          activeRunId={state.run?.runId ?? null}
          onOpen={open}
          onClear={reset}
        />
      )}
    </div>
  );
}

function CompetitorGate({
  run,
  observed,
  busy,
  onApprove,
}: {
  run: IntelRunView;
  observed: number | null;
  busy: boolean;
  onApprove: (domains: string[]) => void;
}) {
  const rows = run.competitors?.rows ?? [];
  const approved = run.approvedCompetitors;

  // Pre-select everything layer 1 kept, then let the obvious weak rows be
  // unchecked — the share column is what makes them obvious. Re-opening a
  // gated run shows what was actually approved instead. The parent's `key`
  // handles re-seeding when the run changes, so this initializer runs once
  // per run rather than being chased by an effect.
  const [selected, setSelected] = useState<string[]>(
    approved ?? rows.map((r) => r.domain),
  );

  if (!run.competitors) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-sm">
        <p className="font-medium">Layer 1 hasn&apos;t returned for this run.</p>
        <p className="mt-1 text-[var(--color-text-secondary)]">
          The keyword list was saved, so re-running it costs one call rather than
          a retype: {run.keywords.join(", ")}
        </p>
      </div>
    );
  }

  const gated = approved !== null;

  function toggle(domain: string) {
    setSelected((prev) =>
      prev.includes(domain)
        ? prev.filter((d) => d !== domain)
        : [...prev, domain],
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-xl font-semibold">
          {rows.length} competitor{rows.length === 1 ? "" : "s"}
        </h2>
        {gated ? (
          <Badge tone="brand">
            {approved.length === 0
              ? "all rejected"
              : `${approved.length} approved`}
          </Badge>
        ) : (
          <Badge tone="warm">awaiting approval</Badge>
        )}
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {observed !== null && `${observed} observed · `}
          {run.competitors.keywordCount} keywords · $
          {run.competitors.cost.toFixed(3)}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
              <th className="w-8 py-2" />
              <th className="py-2 pr-3 font-medium">Domain</th>
              <th className="py-2 pr-3 font-medium">Share</th>
              <th className="py-2 pr-3 font-medium">Keywords</th>
              <th className="py-2 pr-3 font-medium">Avg pos</th>
              <th className="py-2 pr-3 font-medium">Median pos</th>
              <th className="py-2 pr-3 font-medium">Visibility</th>
              <th className="py-2 font-medium">Est. traffic</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row) => (
              <CompetitorRow
                key={row.domain}
                row={row}
                checked={selected.includes(row.domain)}
                disabled={busy}
                onToggle={() => toggle(row.domain)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-5">
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setSelected(rows.map((r) => r.domain))}
            className="font-medium text-[var(--color-brand-primary-dark)] hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="font-medium text-[var(--color-brand-primary-dark)] hover:underline"
          >
            Select none
          </button>
          <span className="text-[var(--color-text-muted)]">
            Layer 2 runs per approved domain.
          </span>
        </div>
        <Button
          type="button"
          variant={gated ? "outline" : "primary"}
          disabled={busy}
          onClick={() => onApprove(selected)}
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Saving…
            </>
          ) : gated ? (
            <>
              <RotateCcw size={16} /> Update approval ({selected.length})
            </>
          ) : (
            <>
              <Check size={16} /> Approve {selected.length} of {rows.length}
            </>
          )}
        </Button>
      </div>

      {gated && (
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-[var(--color-surface-muted)] p-4 text-sm">
          <Lock
            size={16}
            className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
          />
          <p className="text-[var(--color-text-secondary)]">
            {approved.length === 0
              ? "Every competitor was rejected, so layer 2 has nothing to compare against. Re-run layer 1 with a different keyword set, or approve at least one domain."
              : `Gate passed — layer 2 will pull ${approved.length} ${
                  approved.length === 1 ? "domain" : "domains"
                } below.`}
          </p>
        </div>
      )}
    </div>
  );
}

function CompetitorRow({
  row,
  checked,
  disabled,
  onToggle,
}: {
  row: CompetitorRowView;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className={checked ? "" : "opacity-45"}>
      <td className="py-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Approve ${row.domain}`}
        />
      </td>
      <td className="py-2.5 pr-3 font-mono text-[var(--color-brand-primary-dark)]">
        {row.domain}
      </td>
      <td className="py-2.5 pr-3 font-medium">
        {Math.round(row.share * 100)}%
      </td>
      <td className="py-2.5 pr-3 text-[var(--color-text-secondary)]">
        {row.intersections}
      </td>
      <td className="py-2.5 pr-3">{format(row.avgPosition, 1)}</td>
      <td className="py-2.5 pr-3">{format(row.medianPosition, 1)}</td>
      <td className="py-2.5 pr-3 text-[var(--color-text-secondary)]">
        {row.visibility === null ? "—" : `${(row.visibility * 100).toFixed(1)}%`}
      </td>
      <td className="py-2.5 text-[var(--color-text-secondary)]">
        {format(row.estimatedTraffic)}
      </td>
    </tr>
  );
}

/** An em dash for null — "we don't know" must never render as zero. */
function format(value: number | null, decimals = 0): string {
  if (value === null) return "—";
  return decimals > 0
    ? value.toFixed(decimals)
    : Math.round(value).toLocaleString("en-US");
}

function RunHistory({
  runs,
  activeRunId,
  onOpen,
  onClear,
}: {
  runs: IntelRunView[];
  activeRunId: string | null;
  onOpen: (run: IntelRunView) => void;
  onClear: () => void;
}) {
  return (
    <details
      open
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
    >
      <summary className="cursor-pointer font-display text-lg font-semibold">
        Lookup history{" "}
        <span className="text-sm font-normal text-[var(--color-text-muted)]">
          ({runs.length})
        </span>
      </summary>
      <ul className="mt-4 divide-y divide-[var(--color-border)]">
        {runs.map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              onClick={() => onOpen(run)}
              className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-left text-sm transition hover:bg-[var(--color-surface-muted)] ${
                run.runId === activeRunId
                  ? "bg-[var(--color-brand-primary-50)]"
                  : ""
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-brand-primary-dark)]">
                {run.keywords.join(", ")}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {run.keywords.length} kw
              </span>
              <Badge tone={run.approvedCompetitors === null ? "warm" : "brand"}>
                {run.approvedCompetitors === null
                  ? `${run.competitors?.rows.length ?? 0} pending`
                  : `${run.approvedCompetitors.length} approved`}
              </Badge>
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {run.createdAt.slice(0, 16).replace("T", " ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {activeRunId && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline"
        >
          Close the open run
        </button>
      )}
    </details>
  );
}

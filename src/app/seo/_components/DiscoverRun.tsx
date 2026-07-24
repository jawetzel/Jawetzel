"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  Loader2,
  Minus,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Results } from "./results";
import type {
  AnalyzeRunEntry,
  DiscoverState,
  DiscoverStepKey,
  DiscoverStepStatus,
} from "./useDiscoverRun";
import type { CompetitorSuggestion } from "./types";

/**
 * The Discover mode's progress and roll-up view. Pure presentation over the
 * hook's state: the step ladder while running, then the competitor sources,
 * the opportunity table, and one collapsible Results block per analyzed query.
 */

const STEP_ORDER: Array<{ key: DiscoverStepKey; label: string }> = [
  { key: "suggest", label: "Draft seed queries from the page (AI)" },
  { key: "seed", label: "Analyze the seed query" },
  { key: "competitors", label: "Pull what the SERP's competitors rank for" },
  { key: "followups", label: "Analyze the best competitor queries" },
];

export function DiscoverRun({
  state,
  onCancel,
  onAnalyzeOne,
}: {
  state: DiscoverState;
  onCancel: () => void;
  onAnalyzeOne: (query: string) => void;
}) {
  if (state.phase === "idle") return null;
  const running = state.phase === "running";
  const doneRuns = state.runs.filter((r) => r.status === "done").length;

  return (
    <div className="space-y-6">
      {/* ---- Step ladder ---- */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">
            Discover run
            {state.phase === "done" && (
              <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">
                {doneRuns} analyses ·{" "}
                {state.discover?.suggestions.length ?? 0} opportunities
              </span>
            )}
          </h2>
          {running && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {state.phase === "cancelled" && <Badge tone="neutral">cancelled</Badge>}
        </div>
        <ul className="mt-4 space-y-2.5">
          {STEP_ORDER.map(({ key, label }) => {
            const step = state.steps[key];
            return (
              <li key={key} className="flex items-start gap-3 text-sm">
                <StepIcon status={step.status} />
                <div className="min-w-0">
                  <p
                    className={
                      step.status === "pending"
                        ? "text-[var(--color-text-muted)]"
                        : "text-[var(--color-text-primary)]"
                    }
                  >
                    {label}
                  </p>
                  {step.detail && (
                    <p className="truncate font-mono text-xs text-[var(--color-text-muted)]">
                      {step.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {state.phase === "error" && state.error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-3 text-sm">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
            />
            <p className="text-[var(--color-status-error)]">{state.error}</p>
          </div>
        )}
      </div>

      {/* ---- Who the competition is ---- */}
      {state.discover && state.discover.competitors.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Competitors on “{state.discover.targetQuery}”
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {state.discover.competitors.map((c) => (
              <span
                key={c.domain}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs"
              >
                <span className="font-mono">{c.domain}</span>
                <span className="text-[var(--color-text-muted)]">
                  #{c.serpPosition}
                </span>
                {c.failed ? (
                  <span className="text-[var(--color-status-error)]">
                    pull failed
                  </span>
                ) : (
                  <span className="text-[var(--color-text-muted)]">
                    {c.keywordsSampled} kw
                    {c.fromCorpus ? " · corpus" : ""}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---- The opportunity table ---- */}
      {state.discover && state.discover.suggestions.length > 0 && (
        <OpportunityTable
          suggestions={state.discover.suggestions}
          runs={state.runs}
          canAnalyze={!running}
          onAnalyzeOne={onAnalyzeOne}
        />
      )}

      {/* ---- One result block per analyzed query ---- */}
      {state.runs.map((run, index) => (
        <RunSection key={run.id} run={run} defaultOpen={index === 0} />
      ))}
    </div>
  );
}

function StepIcon({ status }: { status: DiscoverStepStatus }) {
  switch (status) {
    case "running":
      return (
        <Loader2
          size={16}
          className="mt-0.5 shrink-0 animate-spin text-[var(--color-brand-primary-dark)]"
        />
      );
    case "done":
      return (
        <Check
          size={16}
          className="mt-0.5 shrink-0 text-[var(--color-brand-primary-dark)]"
        />
      );
    case "failed":
      return (
        <AlertTriangle
          size={16}
          className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
        />
      );
    case "skipped":
      return (
        <Minus
          size={16}
          className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
        />
      );
    default:
      return (
        <Circle
          size={16}
          className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
        />
      );
  }
}

function OpportunityTable({
  suggestions,
  runs,
  canAnalyze,
  onAnalyzeOne,
}: {
  suggestions: CompetitorSuggestion[];
  runs: AnalyzeRunEntry[];
  canAnalyze: boolean;
  onAnalyzeOne: (query: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
      <h3 className="font-display text-lg font-semibold">
        Queries the competition wins
      </h3>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Page-one queries held by the domains above, on-topic for your page and
        not yet analyzed. Scored by demand, winnability, and how many of them
        rank.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
              <th className="py-2 pr-3 font-medium">Query</th>
              <th className="py-2 pr-3 font-medium">Vol</th>
              <th className="py-2 pr-3 font-medium">Diff</th>
              <th className="py-2 pr-3 font-medium">Who ranks</th>
              <th className="py-2 pr-3 font-medium">Score</th>
              <th className="py-2 font-medium">Your run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {suggestions.map((s) => (
              <tr key={s.query}>
                <td className="py-2.5 pr-3 font-mono text-[var(--color-brand-primary-dark)]">
                  {s.query}
                </td>
                <td className="py-2.5 pr-3">{s.searchVolume ?? "—"}</td>
                <td className="py-2.5 pr-3">{s.difficulty ?? "—"}</td>
                <td className="py-2.5 pr-3 text-xs text-[var(--color-text-secondary)]">
                  {s.competitorCount} · best #{s.bestPosition}
                </td>
                <td className="py-2.5 pr-3">
                  <Badge tone="brand">{s.score}</Badge>
                </td>
                <td className="py-2.5">
                  <RunStatusCell
                    run={runs.find((r) => r.query === s.query)}
                    canAnalyze={canAnalyze}
                    onAnalyze={() => onAnalyzeOne(s.query)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunStatusCell({
  run,
  canAnalyze,
  onAnalyze,
}: {
  run: AnalyzeRunEntry | undefined;
  canAnalyze: boolean;
  onAnalyze: () => void;
}) {
  if (run?.status === "running") {
    return (
      <Loader2
        size={14}
        className="animate-spin text-[var(--color-brand-primary-dark)]"
      />
    );
  }
  if (run?.status === "done" && run.response) {
    const position = run.response.sample.ourPosition;
    return (
      <span className="text-xs text-[var(--color-text-secondary)]">
        {position === null ? "not in top 10" : `you rank #${position}`} ·{" "}
        {run.response.swaps.length} swaps
      </span>
    );
  }
  if (run?.status === "failed") {
    return (
      <span className="text-xs text-[var(--color-status-error)]">failed</span>
    );
  }
  return (
    <button
      type="button"
      disabled={!canAnalyze}
      onClick={onAnalyze}
      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline disabled:opacity-50"
    >
      <Search size={12} /> Analyze
    </button>
  );
}

function RunSection({
  run,
  defaultOpen,
}: {
  run: AnalyzeRunEntry;
  defaultOpen: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
    >
      <summary className="cursor-pointer">
        <span className="font-mono text-sm text-[var(--color-brand-primary-dark)]">
          {run.query}
        </span>{" "}
        <span className="text-xs text-[var(--color-text-muted)]">
          {run.status === "running"
            ? "analyzing…"
            : run.status === "failed"
              ? `failed · ${run.error ?? "unknown error"}`
              : run.response
                ? `${run.response.swaps.length} swaps · ${
                    run.response.sample.ourPosition === null
                      ? "not in top 10"
                      : `you rank #${run.response.sample.ourPosition}`
                  }`
                : ""}
        </span>
      </summary>
      <div className="mt-4">
        {run.status === "running" && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" /> Crawling the SERP and
            competitors…
          </p>
        )}
        {run.status === "failed" && (
          <p className="text-sm text-[var(--color-status-error)]">
            {run.error ?? "Analysis failed."}
          </p>
        )}
        {run.status === "done" && run.response && (
          <Results result={run.response} />
        )}
      </div>
    </details>
  );
}

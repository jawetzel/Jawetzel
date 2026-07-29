"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkOrderPanel } from "./WorkOrderPanel";
import type { AnalyzeResponse, Swap, SwapArea, TermCount } from "./types";

/**
 * The analyze-result views, shared by the single-query form and the Discover
 * mode (which renders one of these per analyzed query). Pure presentation:
 * the endpoint already sorts swaps by `suggestedScore - currentScore`, so
 * everything renders in the order received.
 */

/** One-line reminder of what each area answers (from API.md). */
const AREA_HINT: Record<SwapArea, string> = {
  title: "What to call it",
  meta: "What the snippet should say",
  headings: "What sections to have",
  facts: "Which fact types to state",
  entities: "Which specific items to name",
  questions: "Which questions to answer",
  schema: "What to mark up",
  links: "Internal links out",
  length: "How long it should be",
};

export function Results({ result }: { result: AnalyzeResponse }) {
  const { sample } = result;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-display text-xl font-semibold">
            {result.swaps.length} swap{result.swaps.length === 1 ? "" : "s"}
          </h2>
          <Badge tone="brand">
            {sample.ourPosition === null
              ? "not in top 10"
              : `you rank #${sample.ourPosition}`}
          </Badge>
          {sample.serpFromCorpus && <Badge tone="neutral">SERP from corpus</Badge>}
          <CopyJsonButton payload={result} />
        </div>
        <p className="mt-1 break-words text-sm text-[var(--color-text-secondary)]">
          <span className="font-mono">{result.query}</span> · {result.url}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label="Competitors" value={String(sample.competitors)} />
          <Stat
            label="Crawled"
            value={`${sample.crawled}${
              sample.crawlFailures ? ` (${sample.crawlFailures} failed)` : ""
            }`}
          />
          <Stat label="Location" value={result.location} />
          <Stat
            label="Duration"
            value={
              result.durationMs != null
                ? `${(result.durationMs / 1000).toFixed(1)}s`
                : "—"
            }
          />
        </dl>
        {sample.features.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sample.features.map((f) => (
              <Badge key={f} tone="warm">
                {f}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* The answer. The swap cards below are the evidence behind it — the
          hierarchy is deliberately this way round. */}
      {result.analysisId && <WorkOrderPanel analysisId={result.analysisId} />}

      <div className="space-y-4">
        {result.swaps.map((swap) => (
          <SwapCard key={swap.area} swap={swap} />
        ))}
      </div>

      {/* Raw diagnostic sections, only when requested via include. */}
      <RawSection label="history" value={result.history} />
      <RawSection label="serp" value={result.serp} />
      <RawSection label="facts" value={result.facts} />
      <RawSection label="keywords" value={result.keywords} />
    </div>
  );
}

/** Copies the displayed run (live response or re-opened history row) as
 *  pretty-printed JSON. Flashes a confirmation, then resets. */
export function CopyJsonButton({ payload }: { payload: unknown }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline"
    >
      {state === "copied" ? (
        <>
          <Check size={12} /> Copied
        </>
      ) : state === "failed" ? (
        <>
          <AlertTriangle size={12} /> Copy failed
        </>
      ) : (
        <>
          <Copy size={12} /> Copy JSON
        </>
      )}
    </button>
  );
}

function SwapCard({ swap }: { swap: Swap }) {
  const leverage = swap.suggestedScore - swap.currentScore;
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold capitalize">
            {swap.area}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {AREA_HINT[swap.area]}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">
            now {swap.currentScore}
          </span>
          <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
          <span className="font-semibold">{swap.suggestedScore}</span>
          {leverage > 0 && <Badge tone="brand">+{leverage}</Badge>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Current
          </p>
          <ValueView value={swap.current} />
        </div>
        {swap.suggested !== undefined && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Suggested
            </p>
            <ValueView value={swap.suggested} emphasize />
          </div>
        )}
      </div>

      {swap.signals && <SignalsView signals={swap.signals} />}

      {swap.provenance && swap.provenance.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)]">
            Provenance ({swap.provenance.length} features considered)
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {swap.provenance.map((t) => (
              <TermChip key={t.term} term={t} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SignalsView({
  signals,
}: {
  signals: NonNullable<Swap["signals"]>;
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
      {signals.terms && signals.terms.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Missing terms
          </p>
          <div className="flex flex-wrap gap-1.5">
            {signals.terms.map((t) => (
              <TermChip key={t.term} term={t} />
            ))}
          </div>
        </div>
      )}
      {signals.patterns && signals.patterns.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Patterns
          </p>
          <div className="flex flex-wrap gap-1.5">
            {signals.patterns.map((t) => (
              <TermChip key={t.term} term={t} />
            ))}
          </div>
        </div>
      )}
      {signals.lengthMedian != null && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Median length:{" "}
          <span className="font-medium">{signals.lengthMedian}</span>
        </p>
      )}
      {signals.examples && signals.examples.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Competitor examples
          </p>
          <ul className="space-y-1">
            {signals.examples.map((ex, i) => (
              <li
                key={i}
                className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-secondary)]"
              >
                {ex}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ValueView({
  value,
  emphasize,
}: {
  value: string | string[] | number | null | undefined;
  emphasize?: boolean;
}) {
  const strong = emphasize
    ? "text-[var(--color-text-primary)]"
    : "text-[var(--color-text-secondary)]";

  if (value === null || value === undefined) {
    return <p className="text-sm italic text-[var(--color-text-muted)]">none</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <p className="text-sm italic text-[var(--color-text-muted)]">none</p>
      );
    }
    return (
      <ul className="flex flex-wrap gap-1.5">
        {value.map((v, i) => (
          <li
            key={i}
            className={`rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs ${strong}`}
          >
            {v}
          </li>
        ))}
      </ul>
    );
  }
  return <p className={`text-sm ${strong}`}>{String(value)}</p>;
}

function TermChip({ term }: { term: TermCount }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs">
      {term.term}
      <span className="text-[var(--color-text-muted)]">
        {term.in}/{term.of}
      </span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="font-medium text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}

function RawSection({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
      <summary className="cursor-pointer font-medium capitalize">
        {label}
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-[var(--color-surface-muted)] p-4 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

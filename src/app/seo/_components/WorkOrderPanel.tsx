"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WorkOrderResponse, WorkOrderView } from "./types";

/**
 * Layer 4b — the swaps, written out.
 *
 * Sits **above** the swap cards and inverts the old hierarchy: the work order is
 * the answer, the swaps are the evidence behind it. seo.md set the target in the
 * owner's words — *"I need to reword this, this post needs adjusting in these
 * ways"* — and the engine deliberately stops one step short of it, emitting
 * signals rather than prose. This is that last step.
 *
 * Costs nothing at the vendor: it reads a run already paid for. Re-rendering is
 * tokens only, which is why "Rewrite" is offered rather than hidden.
 */

export function WorkOrderPanel({ analysisId }: { analysisId: string }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "error">("idle");
  const [result, setResult] = useState<WorkOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function render(refresh: boolean) {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/seo/work-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, refresh }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setError(body.error ?? `Request failed (${res.status}).`);
        return;
      }
      setResult(body as WorkOrderResponse);
      setPhase("idle");
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Request failed.");
    }
  }

  if (!result && phase === "idle") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
        <div className="text-sm">
          <p className="font-medium">What to actually do</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Writes the swaps below into a work order. No vendor cost — it reads
            this run.
          </p>
        </div>
        <Button type="button" variant="primary" onClick={() => void render(false)}>
          <FileText size={16} /> Write it up
        </Button>
      </div>
    );
  }

  if (phase === "loading" && !result) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5 text-sm text-[var(--color-text-muted)]">
        <Loader2 size={16} className="animate-spin" /> Writing the work order…
      </div>
    );
  }

  if (phase === "error" && !result) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-5 text-sm">
        <AlertTriangle
          size={18}
          className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
        />
        <div>
          <p className="font-medium text-[var(--color-status-error)]">{error}</p>
          <button
            type="button"
            onClick={() => void render(false)}
            className="mt-2 text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!result) return null;
  const { workOrder } = result;

  return (
    <div className="rounded-2xl border border-[var(--color-brand-primary)] bg-[var(--color-surface-elevated)] p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="max-w-2xl font-display text-xl font-semibold leading-snug">
          {workOrder.headline}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {result.cached && <Badge tone="neutral">cached</Badge>}
          <button
            type="button"
            disabled={phase === "loading"}
            onClick={() => void render(true)}
            className="text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline disabled:opacity-50"
          >
            {phase === "loading" ? "Rewriting…" : "Rewrite"}
          </button>
        </div>
      </div>

      <ol className="mt-6 space-y-4">
        {workOrder.items.map((item, i) => (
          <li key={item.area} className="flex gap-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-primary-100)] text-xs font-semibold">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.action}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                <span className="font-mono uppercase">{item.area}</span>
                {item.evidence && ` · ${item.evidence}`}
                {/* Leverage comes from the swap, never from the model. */}
                {item.leverage > 0 && ` · +${item.leverage} pts`}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {workOrder.titleOptions.length > 0 && (
        <Options label="Title options" values={workOrder.titleOptions} />
      )}
      {workOrder.metaOption && (
        <Options label="Meta description" values={[workOrder.metaOption]} />
      )}

      <p className="mt-6 text-xs text-[var(--color-text-muted)]">
        Written by {workOrder.model} from the measurements below. Every number
        here is the engine&apos;s; the wording is the model&apos;s.
      </p>
    </div>
  );
}

/** Copyable candidates — the point is to paste them, not admire them. */
function Options({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </p>
      <ul className="space-y-2">
        {values.map((value, i) => (
          <li key={i}>
            <CopyRow value={value} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      className="flex w-full items-start gap-3 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 text-left text-sm transition hover:bg-[var(--color-brand-primary-50)]"
    >
      <span className="min-w-0 flex-1">{value}</span>
      <span className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </span>
      <span className="mt-0.5 shrink-0 text-xs text-[var(--color-text-muted)]">
        {value.length}
      </span>
    </button>
  );
}

export type { WorkOrderView };

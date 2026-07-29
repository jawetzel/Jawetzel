"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Split,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type {
  GapKeywordView,
  RoutePageResponse,
  RouteVerdictView,
  RoutingView,
} from "../../_components/workspace-types";

/**
 * Layer 4a — sort the accepted pile against one page.
 *
 * **This is the only place a model touches the pipeline**, and only for the one
 * question frequency analysis does badly: is this keyword about the same thing
 * as this page? Everything upstream — positions, volumes, weakness scores —
 * stays deterministic. `improve` is never asked: the vendor already told us
 * which of our URLs holds the ranking.
 *
 * Every verdict is correctable, and a correction outranks every later re-route.
 * That asymmetry is what makes letting a model classify safe: it is allowed to
 * be wrong, because the fix is one click and it sticks.
 */

const VERDICT_LABEL: Record<RouteVerdictView, string> = {
  improve: "Improve",
  enrich: "Enrich",
  create: "Create",
};

const VERDICT_HINT: Record<RouteVerdictView, string> = {
  improve: "You rank for these with this page, but poorly. Fix the page.",
  enrich: "On-topic for this page, but it never says so. Work these in.",
  create: "Off-topic for this page — belongs elsewhere. Parked in the backlog.",
};

const VERDICT_TONE: Record<RouteVerdictView, "brand" | "warm" | "neutral"> = {
  improve: "brand",
  enrich: "warm",
  create: "neutral",
};

export function PageRun({
  tag,
  acceptedCount,
  rowsByKeyword,
}: {
  tag: string;
  acceptedCount: number;
  /** The pile, for volume and weakness alongside each verdict. */
  rowsByKeyword: Map<string, GapKeywordView>;
}) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "routing" | "saving" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RoutePageResponse | null>(null);

  async function route() {
    setPhase("routing");
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/seo/tags/${encodeURIComponent(tag)}/route-page`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setError(body.error ?? `Request failed (${res.status}).`);
        return;
      }
      setResult(body as RoutePageResponse);
      setPhase("idle");
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Request failed.");
    }
  }

  /** Correct one verdict. Optimistic — the correction is durable server-side. */
  async function override(keyword: string, verdict: RouteVerdictView) {
    if (!result) return;
    setPhase("saving");
    setResult({
      ...result,
      routings: result.routings.map((r) =>
        r.keyword === keyword ? { ...r, verdict, overridden: true } : r,
      ),
    });
    await fetch(`/api/seo/tags/${encodeURIComponent(tag)}/route-page`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: result.pageUrl, keyword, verdict }),
    }).catch(() => undefined);
    setPhase("idle");
  }

  const busy = phase === "routing" || phase === "saving";

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">
          <span className="font-mono text-sm text-[var(--color-text-muted)]">
            L4 ·{" "}
          </span>
          Sort the pile against one page
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <Sparkles size={12} /> the one AI step
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void route();
        }}
        className="mt-5 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-[280px] flex-1 space-y-2">
          <Label htmlFor="pageUrl">Page URL</Label>
          <Input
            id="pageUrl"
            type="url"
            inputMode="url"
            placeholder="https://weekendplant.com/garden-skills/trees-of-the-north"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || acceptedCount === 0}
        >
          {phase === "routing" ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Sorting…
            </>
          ) : (
            <>
              Route {acceptedCount || ""} <Split size={16} />
            </>
          )}
        </Button>
      </form>

      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {acceptedCount === 0
          ? "Accept some keywords above first."
          : "Crawls the page, then sorts every accepted keyword into improve, enrich, or create against its content."}
      </p>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-3 text-sm">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
          />
          <p className="text-[var(--color-status-error)]">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-6">
          <div className="rounded-xl bg-[var(--color-surface-muted)] p-4 text-sm">
            <p className="font-medium">{result.pageTitle ?? result.pageUrl}</p>
            <p className="mt-1 text-[var(--color-text-secondary)]">
              {result.counts.improve} improve · {result.counts.enrich} enrich ·{" "}
              {result.counts.create} create
              {result.ownedElsewhere > 0 &&
                ` · ${result.ownedElsewhere} owned by another of your pages`}
              {result.preserved > 0 &&
                ` · ${result.preserved} kept from your corrections`}
            </p>
          </div>

          {(["improve", "enrich", "create"] as const).map((verdict) => {
            const rows = result.routings.filter((r) => r.verdict === verdict);
            if (rows.length === 0) return null;
            return (
              <VerdictGroup
                key={verdict}
                verdict={verdict}
                rows={rows}
                rowsByKeyword={rowsByKeyword}
                pageUrl={result.pageUrl}
                disabled={busy}
                onOverride={override}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerdictGroup({
  verdict,
  rows,
  rowsByKeyword,
  pageUrl,
  disabled,
  onOverride,
}: {
  verdict: RouteVerdictView;
  rows: RoutingView[];
  rowsByKeyword: Map<string, GapKeywordView>;
  pageUrl: string;
  disabled: boolean;
  onOverride: (keyword: string, verdict: RouteVerdictView) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-display text-lg font-semibold">
          {VERDICT_LABEL[verdict]}
        </h3>
        <Badge tone={VERDICT_TONE[verdict]}>{rows.length}</Badge>
        <p className="text-xs text-[var(--color-text-muted)]">
          {VERDICT_HINT[verdict]}
        </p>
      </div>

      <ul className="mt-3 divide-y divide-[var(--color-border)]">
        {rows.map((routing) => {
          const row = rowsByKeyword.get(routing.keyword);
          return (
            <li
              key={routing.keyword}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
            >
              <span className="font-mono text-[var(--color-brand-primary-dark)]">
                {routing.keyword}
              </span>
              {row?.searchVolume != null && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  vol {row.searchVolume.toLocaleString("en-US")}
                </span>
              )}
              {row?.screening && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  weak {row.screening.weaknessScore}
                </span>
              )}
              {routing.rationale && (
                <span className="text-xs italic text-[var(--color-text-muted)]">
                  {routing.rationale}
                </span>
              )}
              {routing.overridden && <Badge tone="brand">yours</Badge>}

              <span className="ml-auto flex items-center gap-2">
                {verdict !== "improve" && (
                  <MoveButton
                    disabled={disabled}
                    to={verdict === "enrich" ? "create" : "enrich"}
                    onClick={() =>
                      onOverride(
                        routing.keyword,
                        verdict === "enrich" ? "create" : "enrich",
                      )
                    }
                  />
                )}
                {(verdict === "improve" || verdict === "enrich") && (
                  <a
                    href={`/seo/analyze?url=${encodeURIComponent(pageUrl)}&q=${encodeURIComponent(routing.keyword)}`}
                    className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline"
                  >
                    Analyze <ArrowRight size={12} />
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MoveButton({
  to,
  disabled,
  onClick,
}: {
  to: RouteVerdictView;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="whitespace-nowrap text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline disabled:opacity-50"
    >
      → {VERDICT_LABEL[to]}
    </button>
  );
}

"use client";

import { useCallback, useState } from "react";
import type {
  BuildGapPileResponse,
  GapKeywordView,
  GapPileResponse,
  GapStatusView,
  ScreenResponse,
} from "../../_components/workspace-types";

/**
 * useGapPile — layer 2's closed loop: run it, read the pile, accept or reject.
 *
 * The pile is **tag-scoped**, not run-scoped, so this hook keys off the tag and
 * survives switching between runs. Statuses are applied optimistically: the
 * server is the authority, but a reviewer working through two hundred rows
 * should not wait on a round trip per click.
 */

export interface GapPileState {
  phase: "idle" | "building" | "screening" | "loading" | "saving" | "error";
  rows: GapKeywordView[];
  counts: Record<GapStatusView, number>;
  /** The last build's report, so the UI can show what a run actually cost. */
  lastBuild: BuildGapPileResponse | null;
  /** The last screening run's report. */
  lastScreen: ScreenResponse | null;
  error: string | null;
}

const INITIAL: GapPileState = {
  phase: "idle",
  rows: [],
  counts: { new: 0, accepted: 0, rejected: 0 },
  lastBuild: null,
  lastScreen: null,
  error: null,
};

async function call<T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  payload?: Record<string, unknown>,
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const res = await fetch(path, {
    method,
    ...(payload
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {}),
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const record = (body ?? {}) as { error?: unknown };
    return {
      ok: false,
      error:
        typeof record.error === "string"
          ? record.error
          : `Request failed (${res.status}).`,
    };
  }
  return { ok: true, body: body as T };
}

export function useGapPile({
  tag,
  initialPile,
  onRunAdvanced,
}: {
  tag: string;
  initialPile: GapPileResponse | null;
  /** Layer 2 moves the run to `gaps_ready`; the page keeps its copy in step. */
  onRunAdvanced?: (run: BuildGapPileResponse["run"]) => void;
}) {
  const [state, setState] = useState<GapPileState>({
    ...INITIAL,
    rows: initialPile?.rows ?? [],
    counts: initialPile?.counts ?? INITIAL.counts,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, phase: "loading", error: null }));
    const result = await call<GapPileResponse>(
      `/api/seo/tags/${encodeURIComponent(tag)}/gaps`,
      "GET",
    );
    if (!result.ok) {
      setState((prev) => ({ ...prev, phase: "error", error: result.error }));
      return;
    }
    setState((prev) => ({
      ...prev,
      phase: "idle",
      rows: result.body.rows,
      counts: result.body.counts,
    }));
  }, [tag]);

  /** Layer 2: one call per approved competitor, plus our own rankings. */
  async function build(runId: string) {
    setState((prev) => ({ ...prev, phase: "building", error: null }));
    const result = await call<BuildGapPileResponse>(
      `/api/seo/runs/${runId}/gaps`,
      "POST",
    );
    if (!result.ok) {
      setState((prev) => ({ ...prev, phase: "error", error: result.error }));
      return;
    }
    setState((prev) => ({ ...prev, lastBuild: result.body }));
    onRunAdvanced?.(result.body.run);
    await refresh();
  }

  /**
   * Layer 3: observe the SERP for every accepted keyword and score how soft
   * the incumbents are. Corpus-first, so re-screening after a rethink is free.
   */
  async function screen(options: { rescreen?: boolean } = {}) {
    setState((prev) => ({ ...prev, phase: "screening", error: null }));
    const result = await call<ScreenResponse>(
      `/api/seo/tags/${encodeURIComponent(tag)}/screen`,
      "POST",
      options.rescreen ? { rescreen: true } : {},
    );
    if (!result.ok) {
      setState((prev) => ({ ...prev, phase: "error", error: result.error }));
      return;
    }
    setState((prev) => ({ ...prev, lastScreen: result.body }));
    await refresh();
  }

  /** The layer-2 gate. Optimistic — the reviewer keeps moving. */
  async function setStatus(keywords: string[], status: GapStatusView) {
    if (keywords.length === 0) return;
    const targeted = new Set(keywords);

    setState((prev) => ({
      ...prev,
      phase: "saving",
      rows: prev.rows.map((row) =>
        targeted.has(row.keyword) ? { ...row, status } : row,
      ),
      counts: recount(prev.rows, targeted, status),
      error: null,
    }));

    const result = await call<{ changed: number }>(
      `/api/seo/tags/${encodeURIComponent(tag)}/gaps`,
      "PATCH",
      { keywords, status },
    );

    if (!result.ok) {
      // The optimistic edit was a guess; the server disagreed, so re-read
      // rather than leaving the screen showing something that never happened.
      setState((prev) => ({ ...prev, phase: "error", error: result.error }));
      await refresh();
      return;
    }
    setState((prev) => ({ ...prev, phase: "idle" }));
  }

  return { state, build, screen, refresh, setStatus };
}

/** Recompute the status tallies for an optimistic edit, without a round trip. */
function recount(
  rows: GapKeywordView[],
  targeted: Set<string>,
  status: GapStatusView,
): Record<GapStatusView, number> {
  const counts: Record<GapStatusView, number> = {
    new: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const row of rows) {
    counts[targeted.has(row.keyword) ? status : row.status] += 1;
  }
  return counts;
}

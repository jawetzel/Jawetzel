"use client";

import { useState } from "react";
import type {
  FieldErrorView,
  IntelRunView,
  StartRunResponse,
} from "../../_components/workspace-types";

/**
 * useIntelRun — the workspace's one closed loop: start layer 1, read what came
 * back, pass the gate.
 *
 * Deliberately thinner than `useDiscoverRun`. That hook orchestrates a chain of
 * calls and owns everything it accumulates, because a Discover run lives only
 * in the browser. Here the server owns the run: every step returns the whole
 * `IntelRunView`, so this holds one run and replaces it wholesale rather than
 * merging deltas. Nothing here is state that would be lost on a refresh — the
 * page reloads it from Mongo.
 *
 * Renders nothing; testable without a DOM.
 */

export type Phase = "idle" | "running" | "approving" | "error";

export interface IntelRunState {
  phase: Phase;
  run: IntelRunView | null;
  error: string | null;
  fieldErrors: FieldErrorView[];
  /** Domains layer 1 saw before minShare and the cap trimmed them. */
  observed: number | null;
}

const INITIAL: IntelRunState = {
  phase: "idle",
  run: null,
  error: null,
  fieldErrors: [],
  observed: null,
};

async function post<T>(
  path: string,
  method: "POST" | "PATCH",
  payload: Record<string, unknown>,
): Promise<{ ok: true; body: T } | { ok: false; error: string; fields: FieldErrorView[] }> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const record = (body ?? {}) as { error?: unknown; fields?: unknown };
    return {
      ok: false,
      error:
        typeof record.error === "string"
          ? record.error
          : `Request failed (${res.status}).`,
      fields: Array.isArray(record.fields)
        ? (record.fields as FieldErrorView[])
        : [],
    };
  }
  return { ok: true, body: body as T };
}

export function useIntelRun({
  tag,
  initialRun,
  onRunChanged,
}: {
  tag: string;
  initialRun: IntelRunView | null;
  /** Lets the page keep its history list in step without a reload. */
  onRunChanged?: (run: IntelRunView) => void;
}) {
  const [state, setState] = useState<IntelRunState>({
    ...INITIAL,
    run: initialRun,
  });

  function land(run: IntelRunView, observed: number | null) {
    setState({
      phase: "idle",
      run,
      error: null,
      fieldErrors: [],
      observed,
    });
    onRunChanged?.(run);
  }

  /**
   * Layer 1: keywords in, competitor set out.
   *
   * `minShare` and `maxCompetitors` are deliberately not surfaced — the API
   * defaults them, and neither has been calibrated against real output yet.
   * They go on the form when there is a reason to move them, not before.
   */
  async function start(keywords: string) {
    setState({ ...INITIAL, phase: "running" });
    const result = await post<StartRunResponse>("/api/seo/runs", "POST", {
      tag,
      // The API accepts a comma-separated string; newlines are the natural way
      // to paste a keyword list, so normalize them to commas on the way out.
      keywords: keywords.replace(/\n/g, ","),
    });

    if (!result.ok) {
      setState({
        phase: "error",
        run: null,
        error: result.error,
        fieldErrors: result.fields,
        observed: null,
      });
      return;
    }
    land(result.body.run, result.body.observed);
  }

  /** The layer-1 gate. An empty list is a real answer and is sent as one. */
  async function approve(domains: string[]) {
    const runId = state.run?.runId;
    if (!runId) return;
    setState((prev) => ({ ...prev, phase: "approving", error: null }));

    const result = await post<{ run: IntelRunView }>(
      `/api/seo/runs/${runId}`,
      "PATCH",
      { domains },
    );

    if (!result.ok) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        error: result.error,
        fieldErrors: result.fields,
      }));
      return;
    }
    land(result.body.run, state.observed);
  }

  /** Re-open a stored run from the history list. Costs nothing. */
  function open(run: IntelRunView) {
    setState({ ...INITIAL, run });
  }

  function reset() {
    setState(INITIAL);
  }

  return { state, start, approve, open, reset };
}

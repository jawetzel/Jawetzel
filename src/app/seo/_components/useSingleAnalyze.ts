"use client";

import { useState } from "react";
import type { AnalyzeResponse, FieldError } from "./types";

/**
 * useSingleAnalyze — the single-query mode's run state.
 *
 * One closed loop over `POST /api/seo/analyze`: run it, hold the response, and
 * carry the two distinct failure shapes the route returns — a message, plus
 * per-field errors when the request was rejected structurally (the public-form
 * rule: a failed submit names the offending fields, never a generic error).
 *
 * `onRunComplete` mirrors `useDiscoverRun`: the caller owns the recent-runs
 * list, so a finished run is handed back rather than the hook reaching into the
 * component's state. `showStored` renders an already-persisted run through the
 * same result view without paying for a re-analysis.
 *
 * Extracted from `SeoAnalyzer` — see `useQuerySuggestions` for why.
 */

export type AnalyzeStatus = "idle" | "running" | "done" | "error";

export interface SingleAnalyze {
  status: AnalyzeStatus;
  error: string | null;
  fieldErrors: FieldError[];
  result: AnalyzeResponse | null;
  run: (payload: Record<string, unknown>) => Promise<void>;
  showStored: (response: AnalyzeResponse) => void;
}

export function useSingleAnalyze({
  onRunComplete,
}: {
  onRunComplete: (response: AnalyzeResponse) => void;
}): SingleAnalyze {
  const [status, setStatus] = useState<AnalyzeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function run(payload: Record<string, unknown>) {
    setStatus("running");
    setError(null);
    setFieldErrors([]);
    setResult(null);

    try {
      const res = await fetch("/api/seo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({ error: "Bad response." }));
      if (!res.ok) {
        setStatus("error");
        setError(
          body.error ??
            (body.code ? `${body.code}` : `Request failed (${res.status}).`),
        );
        setFieldErrors(Array.isArray(body.fields) ? body.fields : []);
        return;
      }
      const response = body as AnalyzeResponse;
      setResult(response);
      setStatus("done");
      // Optimistically prepend the run the server just persisted, so the list
      // reflects it without a page reload.
      onRunComplete(response);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  function showStored(response: AnalyzeResponse) {
    setResult(response);
    setStatus("done");
    setError(null);
    setFieldErrors([]);
  }

  return { status, error, fieldErrors, result, run, showStored };
}

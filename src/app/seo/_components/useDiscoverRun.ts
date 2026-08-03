"use client";

import { useRef, useState } from "react";
import type {
  AnalyzeResponse,
  DiscoverResponse,
  QueryCandidate,
} from "./types";

/**
 * useDiscoverRun — the URL-only mode's client-side orchestrator.
 *
 * One closed loop: draft a seed query (AI) → analyze it → ask what that SERP's
 * competitors rank for → analyze the best of those. Each step is one of the
 * existing endpoints, so every call stays inside its own route timeout and the
 * user watches progress land step by step instead of holding one long socket.
 *
 * The hook owns the sequencing, cancellation, and accumulated results; it
 * renders nothing. Per-query analyze failures are recorded on that run and the
 * loop continues — only a failed *step* (no seed, no competitor data) ends the
 * flow, with everything already gathered left on screen.
 */

export type DiscoverStepKey = "suggest" | "seed" | "competitors" | "followups";

export type DiscoverStepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export interface DiscoverStepState {
  status: DiscoverStepStatus;
  detail: string | null;
}

export interface AnalyzeRunEntry {
  /** Stable per-entry id — a retried query gets a fresh entry, not an update. */
  id: number;
  query: string;
  status: "running" | "done" | "failed";
  response: AnalyzeResponse | null;
  error: string | null;
}

export interface DiscoverState {
  phase: "idle" | "running" | "done" | "cancelled" | "error";
  steps: Record<DiscoverStepKey, DiscoverStepState>;
  seed: QueryCandidate | null;
  discover: DiscoverResponse | null;
  /** Seed first, then follow-ups, then any manual extensions. */
  runs: AnalyzeRunEntry[];
  /** The flow-ending failure, when phase is "error". Per-run errors live on runs. */
  error: string | null;
}

export interface DiscoverConfig {
  url: string;
  city: string | null;
  locationCode: number | null;
  languageCode: string | null;
  maxSnapshotAgeDays: number | null;
  /** Builds one analyze payload with the form's advanced options applied. */
  analyzePayload: (query: string) => Record<string, unknown>;
}

/** How many competitor-won queries get analyzed automatically per run. */
const FOLLOW_UP_COUNT = 3;
/** How many SERP domains the competitor step pulls rankings for. */
const MAX_COMPETITORS = 4;
const MAX_SUGGESTIONS = 10;

function freshSteps(): DiscoverState["steps"] {
  return {
    suggest: { status: "pending", detail: null },
    seed: { status: "pending", detail: null },
    competitors: { status: "pending", detail: null },
    followups: { status: "pending", detail: null },
  };
}

const INITIAL_STATE: DiscoverState = {
  phase: "idle",
  steps: freshSteps(),
  seed: null,
  discover: null,
  runs: [],
  error: null,
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

async function post<T>(
  path: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorText =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status}).`;
    throw new Error(errorText);
  }
  return body as T;
}

export function useDiscoverRun({
  onRunComplete,
}: {
  /** Called once per completed analysis, e.g. to prepend the history list. */
  onRunComplete: (run: AnalyzeResponse) => void;
}) {
  const [state, setState] = useState<DiscoverState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const configRef = useRef<DiscoverConfig | null>(null);
  const nextRunIdRef = useRef(1);

  function setStep(
    key: DiscoverStepKey,
    status: DiscoverStepStatus,
    detail: string | null = null,
  ) {
    setState((prev) => ({
      ...prev,
      steps: { ...prev.steps, [key]: { status, detail } },
    }));
  }

  /** Run one analysis; record the outcome on its run entry; null on failure. */
  async function runAnalyze(
    query: string,
    signal: AbortSignal,
  ): Promise<AnalyzeResponse | null> {
    const config = configRef.current;
    if (!config) return null;
    const id = nextRunIdRef.current;
    nextRunIdRef.current += 1;
    setState((prev) => ({
      ...prev,
      runs: [
        ...prev.runs,
        { id, query, status: "running", response: null, error: null },
      ],
    }));
    try {
      const response = await post<AnalyzeResponse>(
        "/api/seo/analyze",
        config.analyzePayload(query),
        signal,
      );
      setState((prev) => ({
        ...prev,
        runs: prev.runs.map((r) =>
          r.id === id ? { ...r, status: "done", response } : r,
        ),
      }));
      onRunComplete(response);
      return response;
    } catch (error) {
      if (isAbort(error)) throw error;
      setState((prev) => ({
        ...prev,
        runs: prev.runs.map((r) =>
          r.id === id
            ? { ...r, status: "failed", error: messageOf(error) }
            : r,
        ),
      }));
      return null;
    }
  }

  async function run(config: DiscoverConfig, signal: AbortSignal) {
    const shared: Record<string, unknown> = {};
    if (config.locationCode != null) shared.locationCode = config.locationCode;
    if (config.languageCode) shared.languageCode = config.languageCode;

    try {
      // ---- 1. Seed query, drafted from the page ----
      setStep("suggest", "running");
      const suggested = await post<{ suggestions?: QueryCandidate[] }>(
        "/api/seo/suggest-queries",
        {
          url: config.url,
          ...shared,
          ...(config.city ? { city: config.city } : {}),
        },
        signal,
      );
      const seed = suggested.suggestions?.[0] ?? null;
      if (!seed) {
        setStep("suggest", "failed", "no usable queries came back");
        throw new Error("No usable target queries came back for this page.");
      }
      setStep("suggest", "done", seed.query);
      setState((prev) => ({ ...prev, seed }));

      // ---- 2. Analyze the seed — this also observes the SERP the next step reads ----
      setStep("seed", "running", seed.query);
      const seedRun = await runAnalyze(seed.query, signal);
      if (!seedRun) {
        setStep("seed", "failed", seed.query);
        throw new Error(
          "The seed analysis failed; the follow-up steps need its SERP.",
        );
      }
      setStep("seed", "done", seed.query);

      // ---- 3. What the SERP's competitors rank for ----
      setStep("competitors", "running");
      const discover = await post<DiscoverResponse>(
        "/api/seo/competitor-queries",
        {
          url: config.url,
          targetQuery: seed.query,
          excludeQueries: [seed.query],
          maxCompetitors: MAX_COMPETITORS,
          maxSuggestions: MAX_SUGGESTIONS,
          ...shared,
          ...(config.maxSnapshotAgeDays != null
            ? { maxSnapshotAgeDays: config.maxSnapshotAgeDays }
            : {}),
        },
        signal,
      );
      setState((prev) => ({ ...prev, discover }));
      setStep(
        "competitors",
        "done",
        `${discover.sample.competitorsWithData} of ${discover.sample.competitorsRequested} domains, ${discover.suggestions.length} queries`,
      );

      // ---- 4. Analyze the best of what they win ----
      const followUps = discover.suggestions.slice(0, FOLLOW_UP_COUNT);
      if (followUps.length === 0) {
        setStep("followups", "skipped", "nothing new worth analyzing");
      } else {
        let completed = 0;
        for (let i = 0; i < followUps.length; i += 1) {
          setStep(
            "followups",
            "running",
            `${i + 1} of ${followUps.length}: ${followUps[i].query}`,
          );
          const response = await runAnalyze(followUps[i].query, signal);
          if (response) completed += 1;
        }
        setStep(
          "followups",
          completed > 0 ? "done" : "failed",
          `${completed} of ${followUps.length} analyzed`,
        );
      }

      setState((prev) => ({ ...prev, phase: "done" }));
    } catch (error) {
      if (isAbort(error)) {
        setState((prev) => ({
          ...prev,
          phase: "cancelled",
          steps: mapRunning(prev.steps, "skipped", "cancelled"),
          runs: prev.runs.map((r) =>
            r.status === "running"
              ? { ...r, status: "failed", error: "cancelled" }
              : r,
          ),
        }));
      } else {
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: messageOf(error),
          steps: mapRunning(prev.steps, "failed", null),
        }));
      }
    } finally {
      abortRef.current = null;
    }
  }

  function start(config: DiscoverConfig) {
    if (abortRef.current) return;
    configRef.current = config;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL_STATE, phase: "running", steps: freshSteps() });
    void run(config, controller.signal);
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function reset() {
    if (abortRef.current) return;
    configRef.current = null;
    setState(INITIAL_STATE);
  }

  /** Analyze one more suggestion after the run finished (the manual round). */
  function analyzeOne(query: string) {
    if (abortRef.current || !configRef.current) return;
    if (state.runs.some((r) => r.query === query && r.status !== "failed")) {
      return;
    }
    void runAnalyze(query, new AbortController().signal);
  }

  return { state, start, cancel, reset, analyzeOne };
}

function mapRunning(
  steps: DiscoverState["steps"],
  to: DiscoverStepStatus,
  detail: string | null,
): DiscoverState["steps"] {
  const next = { ...steps };
  for (const key of Object.keys(next) as DiscoverStepKey[]) {
    if (next[key].status === "running") {
      next[key] = { status: to, detail: detail ?? next[key].detail };
    }
  }
  return next;
}

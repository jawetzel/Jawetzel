"use client";

import { useState } from "react";
import type { QueryCandidate } from "./types";

/**
 * useQuerySuggestions — "I have a URL, tell me what to target."
 *
 * One closed loop over `POST /api/seo/suggest-queries`: ask, hold the returned
 * candidates, and report its own in-flight and failure state. It renders
 * nothing, so it can be exercised without mounting the analyzer form.
 *
 * Extracted from `SeoAnalyzer`, which was carrying this alongside the analyze
 * run and a dozen form fields — 21 `useState` in one function, which is the
 * pile-of-useState the client rules disallow (`local/state-sprawl`). These four
 * belong together and to nothing else, which is what makes them a hook rather
 * than a slice of a reducer.
 */

export interface QuerySuggestions {
  status: "idle" | "loading";
  error: string | null;
  items: QueryCandidate[];
  /** The API had no demand data — the list is LLM guesswork, and the UI says so. */
  ungrounded: boolean;
  suggest: (input: { url: string; city: string }) => Promise<void>;
}

export function useQuerySuggestions(): QuerySuggestions {
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<QueryCandidate[]>([]);
  const [ungrounded, setUngrounded] = useState(false);

  async function suggest({ url, city }: { url: string; city: string }) {
    if (!url.trim()) {
      setError("Enter a page URL first.");
      setItems([]);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/seo/suggest-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          city: city.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({ error: "Bad response." }));
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status}).`);
        setItems([]);
        return;
      }
      setItems(body.suggestions ?? []);
      setUngrounded(body.sample?.metricsAvailable === false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
      setItems([]);
    } finally {
      setStatus("idle");
    }
  }

  return { status, error, items, ungrounded, suggest };
}

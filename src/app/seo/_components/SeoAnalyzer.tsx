"use client";

import { useState } from "react";
import {
  Loader2,
  Search,
  AlertTriangle,
  Compass,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Results } from "./results";
import { DiscoverRun } from "./DiscoverRun";
import { useDiscoverRun } from "./useDiscoverRun";
import type {
  AnalyzeResponse,
  FieldError,
  HistoryItem,
  QueryCandidate,
} from "./types";

/**
 * The analyzer's one interactive surface, in two modes:
 *
 * - **Single query** — the original form: URL + target query, one run of
 *   `POST /api/seo/analyze`, swaps rendered sorted by leverage.
 * - **Discover** — URL only. The `useDiscoverRun` hook chains the existing
 *   endpoints: AI drafts a seed query, the seed is analyzed, the SERP's
 *   competitors' rankings are pulled, and the best queries they win are
 *   analyzed too. Several runs land, plus an opportunity table.
 *
 * Client-side types mirror the API contract (src/app/api/seo/API.md) rather
 * than importing the server DTOs — the client tree never reaches into
 * `application/`.
 */

type Status = "idle" | "running" | "done" | "error";
type Mode = "single" | "discover";

const INCLUDE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "history", label: "history" },
  { value: "keywords", label: "keywords" },
  { value: "facts", label: "facts" },
  { value: "serp", label: "serp" },
  { value: "provenance", label: "provenance" },
];

export function SeoAnalyzer({
  initialHistory = [],
  initialUrl = "",
  initialQuery = "",
}: {
  initialHistory?: HistoryItem[];
  /** Prefilled when arriving from a layer-4 verdict, so nothing is retyped. */
  initialUrl?: string;
  initialQuery?: string;
}) {
  const [mode, setMode] = useState<Mode>("single");
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [url, setUrl] = useState(initialUrl);
  const [targetQuery, setTargetQuery] = useState(initialQuery);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [locationCode, setLocationCode] = useState("");
  const [languageCode, setLanguageCode] = useState("");
  const [entitySchema, setEntitySchema] = useState("");
  const [urgencyTerms, setUrgencyTerms] = useState("");
  const [city, setCity] = useState("");
  const [minShare, setMinShare] = useState("");
  const [maxSnapshotAgeDays, setMaxSnapshotAgeDays] = useState("");
  const [include, setInclude] = useState<string[]>([]);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const [suggestStatus, setSuggestStatus] = useState<"idle" | "loading">("idle");
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<QueryCandidate[]>([]);
  const [suggestUngrounded, setSuggestUngrounded] = useState(false);

  const discover = useDiscoverRun({
    onRunComplete: (run) =>
      setHistory((prev) => [toHistoryItem(run), ...prev]),
  });

  function toggleInclude(value: string) {
    setInclude((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value],
    );
  }

  /** One analyze payload with the advanced options applied — shared by both modes. */
  function buildAnalyzePayload(query: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      url: url.trim(),
      targetQuery: query,
    };
    // Optional knobs — omitted when blank so the API applies its own defaults.
    if (locationCode.trim()) payload.locationCode = Number(locationCode);
    if (languageCode.trim()) payload.languageCode = languageCode.trim();
    if (entitySchema.trim()) payload.entitySchema = entitySchema; // comma string OK
    if (urgencyTerms.trim()) payload.urgencyTerms = urgencyTerms;
    if (city.trim()) payload.city = city.trim();
    if (minShare.trim()) payload.minShare = Number(minShare);
    if (maxSnapshotAgeDays.trim())
      payload.maxSnapshotAgeDays = Number(maxSnapshotAgeDays);
    if (include.length) payload.include = include;
    return payload;
  }

  async function suggest() {
    if (!url.trim()) {
      setSuggestError("Enter a page URL first.");
      setSuggestions([]);
      return;
    }
    setSuggestStatus("loading");
    setSuggestError(null);
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
        setSuggestError(body.error ?? `Failed (${res.status}).`);
        setSuggestions([]);
        return;
      }
      setSuggestions(body.suggestions ?? []);
      setSuggestUngrounded(body.sample?.metricsAvailable === false);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "Failed.");
      setSuggestions([]);
    } finally {
      setSuggestStatus("idle");
    }
  }

  async function runSingleAnalyze() {
    setStatus("running");
    setError(null);
    setFieldErrors([]);
    setResult(null);

    try {
      const res = await fetch("/api/seo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAnalyzePayload(targetQuery.trim())),
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
      setHistory((prev) => [toHistoryItem(response), ...prev]);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode === "discover") {
      discover.start({
        url: url.trim(),
        city: city.trim() || null,
        locationCode: locationCode.trim() ? Number(locationCode) : null,
        languageCode: languageCode.trim() || null,
        maxSnapshotAgeDays: maxSnapshotAgeDays.trim()
          ? Number(maxSnapshotAgeDays)
          : null,
        analyzePayload: buildAnalyzePayload,
      });
      return;
    }
    void runSingleAnalyze();
  }

  function openHistory(item: HistoryItem) {
    // History rows render through the single-mode result view.
    setMode("single");
    setResult(historyToResponse(item));
    setStatus("done");
    setError(null);
    setFieldErrors([]);
  }

  const running = status === "running";
  const discoverRunning = discover.state.phase === "running";
  const busy = mode === "single" ? running : discoverRunning;
  const activeUrl =
    status === "done" && result ? `${result.url} ${result.query}` : null;

  return (
    <div className="space-y-10">
      {/* ---- Form ---- */}
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8"
      >
        {/* Mode toggle */}
        <div className="mb-6 inline-flex rounded-full border border-[var(--color-border-strong)] p-1 text-sm">
          <ModeButton
            active={mode === "single"}
            disabled={discoverRunning}
            onClick={() => setMode("single")}
          >
            <Search size={13} /> Single query
          </ModeButton>
          <ModeButton
            active={mode === "discover"}
            disabled={discoverRunning}
            onClick={() => setMode("discover")}
          >
            <Compass size={13} /> Discover
          </ModeButton>
        </div>

        <div
          className={`grid gap-5 ${mode === "single" ? "md:grid-cols-2" : ""}`}
        >
          <div className="space-y-2">
            <Label htmlFor="url">Page URL</Label>
            <Input
              id="url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/some/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            {mode === "discover" && (
              <p className="text-xs text-[var(--color-text-muted)]">
                That&apos;s the whole input. AI drafts a seed query, the seed is
                analyzed, then the queries its SERP&apos;s competitors win are
                analyzed too.
              </p>
            )}
          </div>
          {mode === "single" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="targetQuery">Target query</Label>
                <button
                  type="button"
                  onClick={suggest}
                  disabled={suggestStatus === "loading"}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-primary-dark)] hover:underline disabled:opacity-50"
                >
                  {suggestStatus === "loading" ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Suggesting…
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} /> Suggest
                    </>
                  )}
                </button>
              </div>
              <Input
                id="targetQuery"
                placeholder="cold hardy trees"
                value={targetQuery}
                onChange={(e) => setTargetQuery(e.target.value)}
                required
              />
            </div>
          )}
        </div>

        {mode === "single" && (suggestions.length > 0 || suggestError) && (
          <SuggestionsPanel
            suggestions={suggestions}
            error={suggestError}
            ungrounded={suggestUngrounded}
            selected={targetQuery}
            onPick={setTargetQuery}
          />
        )}

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-5 text-sm font-medium text-[var(--color-brand-primary-dark)] hover:underline"
        >
          {showAdvanced ? "Hide" : "Show"} advanced options
        </button>

        {showAdvanced && (
          <div className="mt-5 space-y-5 border-t border-[var(--color-border)] pt-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="locationCode">
                  Location code{" "}
                  <span className="text-[var(--color-text-muted)]">
                    (default 2840 = US)
                  </span>
                </Label>
                <Input
                  id="locationCode"
                  inputMode="numeric"
                  placeholder="2840"
                  value={locationCode}
                  onChange={(e) => setLocationCode(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="languageCode">
                  Language{" "}
                  <span className="text-[var(--color-text-muted)]">
                    (default en)
                  </span>
                </Label>
                <Input
                  id="languageCode"
                  placeholder="en"
                  value={languageCode}
                  onChange={(e) => setLanguageCode(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="entitySchema">
                Entity schema{" "}
                <span className="text-[var(--color-text-muted)]">
                  (comma-separated fact types; the highest-leverage field)
                </span>
              </Label>
              <Input
                id="entitySchema"
                placeholder="hardinessZone, matureHeight, sunRequirement, soilType"
                value={entitySchema}
                onChange={(e) => setEntitySchema(e.target.value)}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="urgencyTerms">
                  Urgency terms{" "}
                  <span className="text-[var(--color-text-muted)]">
                    (comma-separated)
                  </span>
                </Label>
                <Input
                  id="urgencyTerms"
                  placeholder="emergency, 24/7, same day"
                  value={urgencyTerms}
                  onChange={(e) => setUrgencyTerms(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="Baton Rouge"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="minShare">
                  Min share{" "}
                  <span className="text-[var(--color-text-muted)]">
                    (0–1, default 0.3)
                  </span>
                </Label>
                <Input
                  id="minShare"
                  inputMode="decimal"
                  placeholder="0.3"
                  value={minShare}
                  onChange={(e) => setMinShare(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxSnapshotAgeDays">
                  Max SERP age (days){" "}
                  <span className="text-[var(--color-text-muted)]">
                    (default 7 · 0 forces fresh)
                  </span>
                </Label>
                <Input
                  id="maxSnapshotAgeDays"
                  inputMode="numeric"
                  placeholder="7"
                  value={maxSnapshotAgeDays}
                  onChange={(e) => setMaxSnapshotAgeDays(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Include extra sections</Label>
              <div className="flex flex-wrap gap-3">
                {INCLUDE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={include.includes(opt.value)}
                      onChange={() => toggleInclude(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-[var(--color-text-muted)]">
            {mode === "single"
              ? "One run crawls your page, the SERP, and up to 10 competitors. Expect 10–40s."
              : "A Discover run is about 5 analyses plus competitor ranking pulls. Expect 2–4 minutes."}
          </p>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />{" "}
                {mode === "single" ? "Analyzing…" : "Discovering…"}
              </>
            ) : mode === "single" ? (
              <>
                Analyze <Search size={16} />
              </>
            ) : (
              <>
                Discover <Compass size={16} />
              </>
            )}
          </Button>
        </div>
      </form>

      {/* ---- Discover progress + roll-up ---- */}
      {mode === "discover" && (
        <DiscoverRun
          state={discover.state}
          onCancel={discover.cancel}
          onAnalyzeOne={discover.analyzeOne}
        />
      )}

      {/* ---- Recent runs ---- */}
      {history.length > 0 && (
        <RecentRuns items={history} activeKey={activeUrl} onOpen={openHistory} />
      )}

      {/* ---- Single-mode error ---- */}
      {mode === "single" && status === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-4 text-sm">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-[var(--color-status-error)]"
          />
          <div>
            <p className="font-medium text-[var(--color-status-error)]">
              {error ?? "Something went wrong."}
            </p>
            {fieldErrors.length > 0 && (
              <ul className="mt-2 space-y-1 text-[var(--color-text-secondary)]">
                {fieldErrors.map((f) => (
                  <li key={f.field}>
                    <span className="font-mono">{f.field}</span>: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---- Single-mode results ---- */}
      {mode === "single" && status === "done" && result && (
        <Results result={result} />
      )}
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition disabled:opacity-50 ${
        active
          ? "bg-[var(--color-brand-primary-deep)] text-[var(--color-text-inverse)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function SuggestionsPanel({
  suggestions,
  error,
  ungrounded,
  selected,
  onPick,
}: {
  suggestions: QueryCandidate[];
  error: string | null;
  ungrounded: boolean;
  selected: string;
  onPick: (query: string) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Suggested queries
        </p>
        {ungrounded && suggestions.length > 0 && (
          <span className="text-xs text-[var(--color-text-muted)]">
            no demand data; LLM guesses only
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-2 text-sm text-[var(--color-status-error)]">{error}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {suggestions.map((s) => (
            <li key={s.query}>
              <button
                type="button"
                onClick={() => onPick(s.query)}
                className={`flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-[var(--color-surface-elevated)] ${
                  selected === s.query
                    ? "bg-[var(--color-brand-primary-50)]"
                    : ""
                }`}
              >
                <span className="font-mono text-[var(--color-brand-primary-dark)]">
                  {s.query}
                </span>
                <span className="ml-auto flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>vol {s.searchVolume ?? "—"}</span>
                  <span>diff {s.difficulty ?? "—"}</span>
                  {s.intent && <span>{s.intent}</span>}
                  <Badge tone="brand">{s.score}</Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Map a live response into a history row (the server persisted the same core). */
function toHistoryItem(res: AnalyzeResponse): HistoryItem {
  return {
    id: res.analysisId,
    url: res.url,
    query: res.query,
    location: res.location,
    runAt: res.analyzedAt,
    formulaVersion: res.formulaVersion,
    swaps: res.swaps,
    sample: res.sample,
  };
}

/** Re-display a stored run through the same Results view — no re-crawl. */
function historyToResponse(item: HistoryItem): AnalyzeResponse {
  return {
    // Carried so a re-opened run can be written up without re-analyzing it.
    analysisId: item.id,
    url: item.url,
    query: item.query,
    location: item.location,
    analyzedAt: item.runAt,
    formulaVersion: item.formulaVersion,
    swaps: item.swaps,
    sample: item.sample,
  };
}

/** Deterministic "YYYY-MM-DD HH:MM" — no locale/timezone, so SSR and client agree. */
function formatRunAt(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function RecentRuns({
  items,
  activeKey,
  onOpen,
}: {
  items: HistoryItem[];
  activeKey: string | null;
  onOpen: (item: HistoryItem) => void;
}) {
  return (
    <details open className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
      <summary className="cursor-pointer font-display text-lg font-semibold">
        Recent runs{" "}
        <span className="text-sm font-normal text-[var(--color-text-muted)]">
          ({items.length})
        </span>
      </summary>
      <ul className="mt-4 divide-y divide-[var(--color-border)]">
        {items.map((item, i) => {
          const isActive = activeKey === `${item.url} ${item.query}`;
          return (
            <li key={`${item.runAt}-${i}`}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-left text-sm transition hover:bg-[var(--color-surface-muted)] ${
                  isActive ? "bg-[var(--color-brand-primary-50)]" : ""
                }`}
              >
                <span className="font-mono text-[var(--color-brand-primary-dark)]">
                  {item.query}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
                  {item.url}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {item.sample.ourPosition === null
                    ? "—"
                    : `#${item.sample.ourPosition}`}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">
                  {formatRunAt(item.runAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Download, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Quota } from "../_lib/quota";
import type { DemoImage, Generation } from "@/types/user";

const ACCEPT = "image/png,image/jpeg,image/jpg";
const MAX_BYTES = 10 * 1024 * 1024;

// Keep in sync with ALLOWED_SIZES in `_lib/pipeline.ts`. The server validates,
// so the worst case for drift is a 400 from the API, not a security issue.
const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "4x4", label: "4×4 in" },
  { value: "5x7", label: "5×7 in" },
  { value: "6x10", label: "6×10 in" },
  { value: "8x8", label: "8×8 in" },
];
const DEFAULT_SIZE = "4x4";

const genKey = (hash: string, size: string) => `${hash}|${size}`;

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "error"; message: string };

type GenerateStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | {
      kind: "inflight";
      // ms timestamp; used by the timeout effect to give up after INFLIGHT_MAX_MS.
      startedAt: number;
      waitingForHash: string;
      waitingForSize: string;
    };

// Cap how long we'll keep polling after a request appears to have timed out.
// The worker's own hard ceiling is ~15 min, so 10 min of post-disconnect
// polling covers virtually every genuine slow run while still surfacing an
// honest "try again" message when the pipeline truly died (e.g. inkstitch
// crashed with unexpected EOF) instead of stalling the user indefinitely.
const INFLIGHT_MAX_MS = 10 * 60_000;

export function ImageUploader({
  initialImages,
  initialGenerations,
  quota,
  children,
}: {
  initialImages: DemoImage[];
  initialGenerations: Generation[];
  quota: Quota;
  // Rendered below the uploads grid in the default view (e.g. past generations
  // list). Hidden in focus mode so the user only sees the selected image and
  // its generation controls.
  children?: ReactNode;
}) {
  const [images, setImages] = useState<DemoImage[]>(initialImages);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [size, setSize] = useState<string>(DEFAULT_SIZE);
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const [generate, setGenerate] = useState<GenerateStatus>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [used, setUsed] = useState<number>(quota.used);
  // Composite (hash + size) keys for generations that already exist. Upload
  // cards hide when the currently-selected size is already generated for
  // that hash — but stay visible if only a different size was generated.
  const [generatedKeys, setGeneratedKeys] = useState<Set<string>>(
    () =>
      new Set(initialGenerations.map((g) => genKey(g.inputHash, g.size))),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const limitReached = !quota.unlimited && used >= quota.limit;

  // Per-upload list of size values still available to generate. Empty array
  // means every allowed size has already been processed for that upload.
  const remainingSizesForHash = (hash: string): string[] =>
    SIZE_OPTIONS.filter((opt) => !generatedKeys.has(genKey(hash, opt.value))).map(
      (opt) => opt.value,
    );

  // An upload card is visible whenever AT LEAST ONE size remains for it. The
  // current-size dropdown filters at the action layer instead — selecting a
  // card whose current size is already done just disables the Generate button.
  const visibleImages = images.filter(
    (i) => remainingSizesForHash(i.hash).length > 0,
  );
  const selected = selectedHash
    ? visibleImages.find((i) => i.hash === selectedHash) ?? null
    : null;
  const isGenerating = generate.kind === "running";

  const sizeLabelByValue = new Map(SIZE_OPTIONS.map((o) => [o.value, o.label]));
  const currentSizeLabel = sizeLabelByValue.get(size) ?? size;
  const selectedDoneAtCurrent = selected
    ? generatedKeys.has(genKey(selected.hash, size))
    : false;
  const isFocused = selected !== null;

  // Past generations for the currently-focused upload, sorted by size order
  // (matches SIZE_OPTIONS) so they line up consistently no matter when they
  // were generated. Empty when no upload is selected.
  const sizeOrder = new Map(SIZE_OPTIONS.map((o, i) => [o.value, i]));
  const generationsForSelected = selected
    ? initialGenerations
        .filter((g) => g.inputHash === selected.hash)
        .slice()
        .sort(
          (a, b) =>
            (sizeOrder.get(a.size) ?? 99) - (sizeOrder.get(b.size) ?? 99),
        )
    : [];

  // Drop the user out of focus mode back to the uploads grid. Preserves
  // inflight state intentionally — the pipeline keeps running server-side
  // and the polling/completion effects still need to fire.
  const cancelSelection = () => {
    setSelectedHash(null);
    if (generate.kind === "error") {
      setGenerate({ kind: "idle" });
    }
  };

  const doUpload = useCallback(async (file: File) => {
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      setUpload({ kind: "error", message: "PNG or JPEG only." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setUpload({ kind: "error", message: "File exceeds 10 MB." });
      return;
    }

    setUpload({ kind: "uploading", name: file.name });
    const form = new FormData();
    form.append("image", file);
    try {
      const res = await fetch("/embroidery/api/upload", {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setUpload({
          kind: "error",
          message: body?.error ?? `Upload failed (${res.status})`,
        });
        return;
      }
      const record: DemoImage = body.image;
      setImages((prev) =>
        [record, ...prev.filter((i) => i.hash !== record.hash)],
      );
      // Only auto-select if the upload has no generation at the current size —
      // otherwise its card won't render at the moment and nothing useful comes
      // of selecting it.
      setSelectedHash((cur) =>
        generatedKeys.has(genKey(record.hash, size)) ? cur : record.hash,
      );
      setGenerate({ kind: "idle" });
      setUpload({ kind: "idle" });
    } catch (err) {
      setUpload({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void doUpload(file);
      e.target.value = "";
    },
    [doUpload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void doUpload(file);
    },
    [doUpload],
  );

  const toggleSelect = (hash: string) => {
    setSelectedHash((cur) => (cur === hash ? null : hash));
    setGenerate({ kind: "idle" });
  };

  const doGenerate = useCallback(async () => {
    if (!selected) return;
    setGenerate({ kind: "running" });
    const startedAt = Date.now();
    const hashToWatch = selected.hash;
    const sizeToWatch = size;
    const enterInflight = () =>
      setGenerate({
        kind: "inflight",
        startedAt: Date.now(),
        waitingForHash: hashToWatch,
        waitingForSize: sizeToWatch,
      });
    try {
      const res = await fetch("/embroidery/api/generate-from-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: selected.url, size: sizeToWatch }),
      });
      // Railway's edge proxy times out long before our ~3-minute pipeline
      // finishes and returns an HTML error page. Detect the non-JSON body
      // and flip to inflight — the worker keeps running server-side and the
      // polling effect below will reconcile when the generation lands.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        enterInflight();
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        // Three kinds of non-OK responses we treat as inflight:
        //   - the route explicitly said inflight (concurrent-generation guard)
        //   - a gateway/proxy timeout status (502/503/504/524)
        //   - any non-OK that arrived after 30s, since at that point a
        //     proxy timeout is the overwhelmingly likely cause and the
        //     pipeline almost certainly keeps running server-side. The
        //     timeout effect caps the wait at INFLIGHT_MAX_MS so a real
        //     pipeline failure surfaces as "try again" eventually.
        const elapsed = Date.now() - startedAt;
        const gatewayTimeout =
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504 ||
          res.status === 524;
        if (body?.inflight || gatewayTimeout || elapsed > 30_000) {
          enterInflight();
        } else {
          setGenerate({
            kind: "error",
            message: body?.error ?? `Failed (${res.status})`,
          });
        }
        return;
      }
      // Dedup hits re-return an existing generation — no new slot consumed.
      if (!body.deduped) {
        setUsed((n) => n + 1);
      }
      // Mark this (hash, size) as generated so the card drops out of the
      // uploads grid while the user is on this size. Switching to a different
      // size will surface the same upload again for a fresh generation.
      setGeneratedKeys((prev) => {
        const next = new Set(prev);
        next.add(genKey(hashToWatch, sizeToWatch));
        return next;
      });
      setSelectedHash(null);
      setGenerate({ kind: "idle" });
      // Re-fetch server data so the new generation appears in GenerationsList.
      router.refresh();
    } catch (err) {
      // Late failures (connection dropped mid-request) are almost always the
      // same proxy timeout in a different shape — treat them as inflight too.
      if (Date.now() - startedAt > 30_000) {
        enterInflight();
        return;
      }
      setGenerate({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [selected, size, router]);

  // While a request is "inflight" (proxy cut us off but the worker is still
  // running), poll the server every 20s. router.refresh() re-runs the parent
  // server component, which feeds new initialGenerations down as props.
  useEffect(() => {
    if (generate.kind !== "inflight") return;
    const id = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [generate, router]);

  // Selecting an image swaps the page into focus mode where the focused card
  // replaces the grid. Scroll to the top so the card lands in view — without
  // this the user often ends up scrolled past their selection on mobile or
  // when they clicked something near the bottom of a long uploads grid.
  useEffect(() => {
    if (selectedHash !== null && typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [selectedHash]);

  // Inflight cap. If the generation never lands within INFLIGHT_MAX_MS we
  // surface a soft error so the user knows to retry — the pipeline genuinely
  // failed (e.g. inkstitch crashed). Without this the "Generating…" banner
  // would persist forever after a real backend failure.
  useEffect(() => {
    if (generate.kind !== "inflight") return;
    const remaining = generate.startedAt + INFLIGHT_MAX_MS - Date.now();
    if (remaining <= 0) {
      setGenerate({
        kind: "error",
        message:
          "Generation didn't complete in time. Try again — your quota wasn't charged. If files arrive by email later, they'll also show up here.",
      });
      return;
    }
    const id = setTimeout(() => {
      setGenerate({
        kind: "error",
        message:
          "Generation didn't complete in time. Try again — your quota wasn't charged. If files arrive by email later, they'll also show up here.",
      });
    }, remaining);
    return () => clearTimeout(id);
  }, [generate]);

  // When a generation matching the watched (hash, size) arrives, clear the
  // inflight banner and run the same UI cleanup the synchronous success path
  // does.
  useEffect(() => {
    if (
      generate.kind !== "inflight" ||
      !generate.waitingForHash ||
      !generate.waitingForSize
    ) {
      return;
    }
    const hash = generate.waitingForHash;
    const watchedSize = generate.waitingForSize;
    const found = initialGenerations.some(
      (g) => g.inputHash === hash && g.size === watchedSize,
    );
    if (!found) return;
    const key = genKey(hash, watchedSize);
    setGeneratedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setSelectedHash((cur) => (cur === hash ? null : cur));
    setUsed((n) => n + 1);
    setGenerate({ kind: "idle" });
  }, [initialGenerations, generate]);

  const resetPretty = quota.nextResetAt
    ? quota.nextResetAt.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  if (limitReached) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-8 text-center">
          <div className="mb-2 text-lg font-medium text-[var(--color-text-primary)]">
            You&apos;re done for the month.
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            You&apos;ve used all {quota.limit} of your generations in the past
            30 days.{" "}
            {resetPretty
              ? `Your next slot opens on ${resetPretty}.`
              : "A new slot opens 30 days after your oldest generation."}{" "}
            Your past generations and downloads are below.
          </p>
        </div>
        {children}
      </div>
    );
  }

  // ============================================================
  // GRID MODE  (no upload selected)
  //   dropzone, upload status, grid of uploads, past generations
  // ============================================================
  const gridMode = (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "cursor-pointer border-[var(--color-brand-primary)] bg-[var(--color-brand-primary-100)]"
            : "cursor-pointer border-[var(--color-border)] hover:border-[var(--color-brand-primary)]"
        }`}
      >
        <UploadCloud size={32} className="text-[var(--color-text-secondary)]" />
        <div className="text-sm">
          <span className="font-medium text-[var(--color-text-primary)]">
            Click to upload
          </span>{" "}
          <span className="text-[var(--color-text-secondary)]">
            or drag a PNG / JPEG
          </span>
        </div>
        <div className="text-xs text-[var(--color-text-secondary)]">
          Max 10 MB
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onPick}
        />
      </div>

      {upload.kind === "uploading" && (
        <div className="text-sm text-[var(--color-text-secondary)]">
          Uploading {upload.name}…
        </div>
      )}
      {upload.kind === "error" && (
        <div className="text-sm text-red-600">{upload.message}</div>
      )}

      {visibleImages.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              Your uploads ({visibleImages.length}) —{" "}
              <span className="font-normal text-[var(--color-text-secondary)]">
                click one to select
              </span>
            </div>
            <div
              className={`text-xs ${
                limitReached
                  ? "text-red-600"
                  : "text-[var(--color-text-secondary)]"
              }`}
            >
              {quota.unlimited
                ? `${used} generations this month — no limit (admin)`
                : limitReached
                  ? `Monthly limit reached (${used}/${quota.limit}).`
                  : `${used} of ${quota.limit} generations used this month`}
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {visibleImages.map((img) => {
              const remaining = remainingSizesForHash(img.hash);
              const remainingLabels = remaining
                .map((v) => sizeLabelByValue.get(v) ?? v)
                .join(", ");
              return (
                <li key={img.key}>
                  <button
                    type="button"
                    onClick={() => toggleSelect(img.hash)}
                    className="block w-full overflow-hidden rounded-xl border-2 border-[var(--color-border)] text-left transition-colors hover:border-[var(--color-brand-primary)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.originalName ?? img.hash}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="space-y-0.5 p-2 text-xs">
                      <div className="truncate text-[var(--color-text-primary)]">
                        {img.originalName ?? "upload"}
                      </div>
                      <div className="text-[var(--color-text-secondary)]">
                        {(img.size / 1024).toFixed(1)} KB
                      </div>
                      <div className="text-[var(--color-text-muted)]">
                        Available: {remainingLabels}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {children}
    </>
  );

  // ============================================================
  // FOCUS MODE  (an upload is selected)
  //   back button, large preview, size + Generate controls
  // ============================================================
  const focusMode = selected && (
    <>
      <button
        type="button"
        onClick={cancelSelection}
        disabled={isGenerating}
        className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronLeft size={16} />
        Back to uploads
      </button>

      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <div className="flex items-center justify-center bg-[var(--color-surface)] p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selected.url}
            alt={selected.originalName ?? selected.hash}
            className="max-h-[420px] max-w-full object-contain"
          />
        </div>
        <div className="space-y-4 p-5">
          <div className="space-y-1">
            <div className="font-medium text-[var(--color-text-primary)]">
              {selected.originalName ?? "upload"}
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {(selected.size / 1024).toFixed(1)} KB · Available:{" "}
              {remainingSizesForHash(selected.hash)
                .map((v) => sizeLabelByValue.get(v) ?? v)
                .join(", ")}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[var(--color-text-secondary)]">
              {selectedDoneAtCurrent
                ? `Already generated at ${currentSizeLabel} — pick a different size.`
                : `Generate at ${currentSizeLabel}.`}
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="embroidery-size">
                Hoop size
              </label>
              <select
                id="embroidery-size"
                value={size}
                disabled={isGenerating}
                onChange={(e) => setSize(e.target.value)}
                className="h-9 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                size="md"
                disabled={
                  selectedDoneAtCurrent ||
                  generate.kind === "running" ||
                  generate.kind === "inflight" ||
                  limitReached
                }
                onClick={doGenerate}
              >
                {generate.kind === "running" || generate.kind === "inflight"
                  ? "Generating…"
                  : "Generate files"}
              </Button>
            </div>
          </div>

          <div
            className={`text-xs ${
              limitReached
                ? "text-red-600"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            {quota.unlimited
              ? `${used} generations this month — no limit (admin)`
              : limitReached
                ? `Monthly limit reached (${used}/${quota.limit}). New slot opens 30 days after your oldest generation.`
                : `${used} of ${quota.limit} generations used this month`}
          </div>

          {generationsForSelected.length > 0 && (
            <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
              <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                Already generated for this image
              </div>
              <div className="flex flex-wrap gap-2">
                {generationsForSelected.map((g) => (
                  <a
                    key={`${g.size}-${new Date(g.createdAt).getTime()}`}
                    href={g.zipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-brand-primary)] hover:text-[var(--color-brand-primary-deep)]"
                  >
                    <Download size={12} />
                    {sizeLabelByValue.get(g.size) ?? g.size} ZIP
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {isFocused ? focusMode : gridMode}

      {(generate.kind === "running" || generate.kind === "inflight") && (
        <div className="rounded-xl border border-[var(--color-brand-primary)] bg-[var(--color-brand-primary-100)] p-4 text-sm text-[var(--color-text-primary)]">
          <div className="mb-1 font-medium">Generating your embroidery files…</div>
          <div className="text-[var(--color-text-secondary)]">
            This might take a minute or two — the pipeline traces your image,
            picks a thread palette, and converts to stitches. If you close this
            tab, you&apos;ll still get an email with the zip when it&apos;s done,
            and it&apos;ll show up on this page.
          </div>
        </div>
      )}

      {generate.kind === "error" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {generate.message}
        </div>
      )}
    </div>
  );
}

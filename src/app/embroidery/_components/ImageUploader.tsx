"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Quota } from "../_lib/quota";
import type { DemoImage, Generation } from "@/types/user";

const ACCEPT = "image/png,image/jpeg,image/jpg";
const MAX_BYTES = 10 * 1024 * 1024;
const GENERATE_SIZE = "4x4";

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "error"; message: string };

type GenerateStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "inflight"; message: string };

export function ImageUploader({
  initialImages,
  initialGenerations,
  quota,
}: {
  initialImages: DemoImage[];
  initialGenerations: Generation[];
  quota: Quota;
}) {
  const [images, setImages] = useState<DemoImage[]>(initialImages);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const [generate, setGenerate] = useState<GenerateStatus>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [used, setUsed] = useState<number>(quota.used);
  // Hashes that already have a 4×4 generation. UI hides these upload cards
  // since there's nothing to do with them in this 4×4-only surface.
  const [generatedHashes, setGeneratedHashes] = useState<Set<string>>(
    () =>
      new Set(
        initialGenerations
          .filter((g) => g.size === GENERATE_SIZE)
          .map((g) => g.inputHash),
      ),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const limitReached = used >= quota.limit;

  const visibleImages = images.filter((i) => !generatedHashes.has(i.hash));
  const selected = selectedHash
    ? visibleImages.find((i) => i.hash === selectedHash) ?? null
    : null;
  const isGenerating = generate.kind === "running";

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
      // Only auto-select if this upload has no 4×4 generation yet — otherwise
      // its card won't render and nothing useful would come of selecting it.
      setSelectedHash((cur) =>
        generatedHashes.has(record.hash) ? cur : record.hash,
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
    try {
      const res = await fetch("/embroidery/api/generate-from-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: selected.url, size: GENERATE_SIZE }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.inflight) {
          setGenerate({
            kind: "inflight",
            message:
              body?.error ??
              "A generation is already running for your account.",
          });
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
      // Mark this hash as generated so the card drops out of the uploads grid.
      setGeneratedHashes((prev) => {
        const next = new Set(prev);
        next.add(selected.hash);
        return next;
      });
      setSelectedHash(null);
      setGenerate({ kind: "idle" });
      // Re-fetch server data so the new generation appears in GenerationsList.
      router.refresh();
    } catch (err) {
      setGenerate({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [selected, router]);

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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        role="button"
        tabIndex={isGenerating ? -1 : 0}
        aria-disabled={isGenerating}
        onClick={() => {
          if (isGenerating) return;
          inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (isGenerating) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isGenerating) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (isGenerating) {
            e.preventDefault();
            return;
          }
          onDrop(e);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          isGenerating
            ? "cursor-not-allowed border-[var(--color-border)] opacity-50"
            : dragOver
              ? "cursor-pointer border-[var(--color-brand-primary)] bg-[var(--color-brand-primary-100)]"
              : "cursor-pointer border-[var(--color-border)] hover:border-[var(--color-brand-primary)]"
        }`}
      >
        <UploadCloud
          size={32}
          className="text-[var(--color-text-secondary)]"
        />
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
                {selected ? "selected one. Generate at 4×4." : "click one to select"}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="primary"
                size="md"
                disabled={
                  !selected || generate.kind === "running" || limitReached
                }
                onClick={doGenerate}
              >
                {generate.kind === "running" ? "Generating…" : "Generate files"}
              </Button>
              <div
                className={`text-xs ${
                  limitReached
                    ? "text-red-600"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                {limitReached
                  ? `Monthly limit reached (${used}/${quota.limit}). New slot opens 30 days after your oldest generation.`
                  : `${used} of ${quota.limit} generations used this month`}
              </div>
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {visibleImages.map((img) => {
              const isSelected = img.hash === selectedHash;
              return (
                <li key={img.key}>
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => toggleSelect(img.hash)}
                    className={`block w-full overflow-hidden rounded-xl border-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      isSelected
                        ? "border-[var(--color-brand-primary)] ring-2 ring-[var(--color-brand-primary)]"
                        : "border-[var(--color-border)] hover:border-[var(--color-brand-primary)]"
                    }`}
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
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {generate.kind === "running" && (
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

      {generate.kind === "inflight" && (
        <div className="rounded-xl border border-[var(--color-brand-primary)] bg-[var(--color-brand-primary-100)] p-4 text-sm text-[var(--color-text-primary)]">
          {generate.message}
        </div>
      )}

    </div>
  );
}

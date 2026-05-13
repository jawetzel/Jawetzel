"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, AlertCircle, Download, RotateCcw } from "lucide-react";

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | {
      kind: "done";
      fileName: string;
      svgUrl: string;
      svgBytes: number;
      downloadName: string;
    }
  | { kind: "error"; message: string };

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

export function ImageToSvgDrop() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastObjectUrl = useRef<string | null>(null);

  // Free the prior blob URL when status changes off of `done`, and on unmount.
  useEffect(() => {
    return () => {
      if (lastObjectUrl.current) {
        URL.revokeObjectURL(lastObjectUrl.current);
        lastObjectUrl.current = null;
      }
    };
  }, []);

  const submit = useCallback(async (file: File) => {
    if (lastObjectUrl.current) {
      URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = null;
    }
    setStatus({ kind: "uploading", fileName: file.name });
    const form = new FormData();
    form.append("image", file);

    try {
      const res = await fetch("/api/tools/image-to-svg", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch {
          // not JSON, use raw text
        }
        setStatus({ kind: "error", message: msg || `Server returned ${res.status}` });
        return;
      }
      const blob = await res.blob();
      const svgUrl = URL.createObjectURL(blob);
      lastObjectUrl.current = svgUrl;

      const disposition = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(disposition);
      const downloadName =
        m?.[1] ?? file.name.replace(/\.[a-zA-Z0-9]+$/, "") + ".svg";

      setStatus({
        kind: "done",
        fileName: file.name,
        svgUrl,
        svgBytes: blob.size,
        downloadName,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      void submit(files[0]);
    },
    [submit],
  );

  const reset = useCallback(() => {
    if (lastObjectUrl.current) {
      URL.revokeObjectURL(lastObjectUrl.current);
      lastObjectUrl.current = null;
    }
    setStatus({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  if (status.kind === "done") {
    return (
      <ResultView
        fileName={status.fileName}
        svgUrl={status.svgUrl}
        svgBytes={status.svgBytes}
        downloadName={status.downloadName}
        onReset={reset}
      />
    );
  }

  const isUploading = status.kind === "uploading";

  return (
    <div className="space-y-4">
      <label
        htmlFor="image-to-svg-input"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          "relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed bg-[var(--color-surface-elevated)] p-10 text-center transition-colors",
          dragOver
            ? "border-[var(--color-brand-primary)] bg-[var(--color-brand-primary-100)]"
            : "border-[var(--color-border)] hover:border-[var(--color-brand-primary)]",
          isUploading ? "pointer-events-none opacity-80" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          id="image-to-svg-input"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={isUploading}
          onChange={(e) => handleFiles(e.target.files)}
        />

        {status.kind === "idle" && <IdleBlock />}
        {status.kind === "uploading" && <UploadingBlock fileName={status.fileName} />}
        {status.kind === "error" && <ErrorBlock message={status.message} />}
      </label>
    </div>
  );
}

function IdleBlock() {
  return (
    <>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
        <Upload size={22} />
      </span>
      <div>
        <p className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Drop an image here, or click to choose
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          PNG, JPG, WebP, GIF, BMP · up to 15 MB
        </p>
      </div>
    </>
  );
}

function UploadingBlock({ fileName }: { fileName: string }) {
  return (
    <>
      <Loader2 size={32} className="animate-spin text-[var(--color-brand-primary)]" />
      <div>
        <p className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Tracing…
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {fileName} · this can take a few seconds for complex images
        </p>
      </div>
    </>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-accent-warm-100)] text-[var(--color-accent-warm-dark)]">
        <AlertCircle size={22} />
      </span>
      <div>
        <p className="font-display text-lg font-semibold text-[var(--color-text-primary)]">
          Something went wrong
        </p>
        <p className="mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">
          {message}
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Drop another file to try again.
        </p>
      </div>
    </>
  );
}

function ResultView({
  fileName,
  svgUrl,
  svgBytes,
  downloadName,
  onReset,
}: {
  fileName: string;
  svgUrl: string;
  svgBytes: number;
  downloadName: string;
  onReset: () => void;
}) {
  const kb = (svgBytes / 1024).toFixed(1);
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
        <div
          className="flex min-h-[260px] items-center justify-center p-6"
          style={{
            // Subtle checkerboard so transparent SVG regions are obvious.
            backgroundImage:
              "linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,0.06) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.06) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.06) 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
          }}
        >
          {/* Render as <img> with the blob URL — pure rendering, no inline
              script context, no external network calls. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={svgUrl}
            alt={`SVG preview of ${fileName}`}
            className="max-h-[560px] max-w-full"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--color-text-primary)]">
            {downloadName}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            From {fileName} · {kb} KB
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-brand-primary)]"
          >
            <RotateCcw size={16} />
            Convert another
          </button>
          <a
            href={svgUrl}
            download={downloadName}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-primary-deep)]"
          >
            <Download size={16} />
            Download SVG
          </a>
        </div>
      </div>
    </div>
  );
}

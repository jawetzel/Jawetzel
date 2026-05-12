import { Download, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Generation } from "@/types/user";

function formatDate(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "4x4" → "4×4 in" so the size reads cleanly. Falls back to the raw value for
// any size we don't have a label for (forward-compatible with new hoop sizes).
function formatSize(raw: string): string {
  const match = /^(\d+)x(\d+)$/.exec(raw);
  return match ? `${match[1]}×${match[2]} in` : raw;
}

export function GenerationsList({
  generations,
}: {
  generations: Generation[];
}) {
  if (generations.length === 0) return null;

  // Newest first — the array is appended to, so reverse for display.
  const ordered = [...generations].reverse();

  return (
    <div>
      <div className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">
        Past generations ({generations.length})
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((g) => (
          <li
            key={`${g.inputHash}-${new Date(g.createdAt).getTime()}`}
            className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]"
          >
            <div className="flex aspect-square items-center justify-center bg-[var(--color-surface)] p-3">
              {g.previewUrl ? (
                // Rendered stitch preview (BMP) served from R2.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.previewUrl}
                  alt={g.inputName ?? "Generation preview"}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-[var(--color-text-secondary)]">
                  <ImageOff size={28} />
                  <span className="text-xs">No preview</span>
                </div>
              )}
            </div>
            <div className="space-y-3 p-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate font-medium text-[var(--color-text-primary)]">
                    {g.inputName ?? "Untitled upload"}
                  </div>
                  <Badge tone="brand" className="shrink-0">
                    {formatSize(g.size)}
                  </Badge>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                  {formatDate(g.createdAt)}
                </div>
              </div>
              <a
                href={g.zipUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-brand-primary-deep)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-brand-primary-dark)]"
              >
                <Download size={14} />
                Download ZIP
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

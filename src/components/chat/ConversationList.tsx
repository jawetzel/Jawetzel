"use client";

import { MessageSquare, Plus } from "lucide-react";
import type { ConversationSummary } from "./types";

export function ConversationList({
  items,
  activeId,
  hasMore,
  onSelect,
  onNew,
  onLoadMore,
}: {
  items: ConversationSummary[];
  activeId: string | null;
  hasMore: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <button
        onClick={onNew}
        className="flex w-full items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold text-[var(--color-brand-primary-deep)] hover:bg-[var(--color-surface-muted)]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand-primary-100)]">
          <Plus size={14} />
        </span>
        New conversation
      </button>

      <div className="py-1">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-xs text-[var(--color-text-muted)]">
            No past conversations yet.
          </p>
        ) : (
          items.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                c.id === activeId
                  ? "bg-[var(--color-brand-primary-50)]"
                  : "hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <MessageSquare size={12} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm text-[var(--color-text-primary)]">
                  {c.title}
                </span>
                <span className="block text-[10px] text-[var(--color-text-muted)]">
                  {formatRelative(c.updatedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {hasMore && (
        <button
          onClick={onLoadMore}
          className="w-full py-2 text-center text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

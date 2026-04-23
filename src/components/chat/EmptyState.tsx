"use client";

import { Sparkles } from "lucide-react";

const STARTERS = [
  "Tell me about Joshua's .NET experience",
  "I need embroidery thread close to mauve",
  "What projects has he built with Next.js?",
  "Any blog posts about legacy modernization?",
];

export function EmptyState({
  onStarterClick,
}: {
  onStarterClick: (msg: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
        <Sparkles size={26} strokeWidth={1.5} />
      </div>
      <h2 className="mt-4 font-display text-xl font-bold text-[var(--color-text-primary)]">
        Ask me anything.
      </h2>
      <p className="mt-1 max-w-[260px] text-sm text-[var(--color-text-secondary)]">
        I can search Joshua&apos;s projects, blog, resume, or find embroidery
        thread colors from the live feed.
      </p>
      <div className="mt-6 flex w-full max-w-[280px] flex-col gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onStarterClick(s)}
            className="rounded-xl border border-[var(--color-brand-primary)]/40 px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-brand-primary-50)] hover:text-[var(--color-text-primary)]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

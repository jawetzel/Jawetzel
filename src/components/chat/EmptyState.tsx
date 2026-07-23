"use client";

import { Sparkles } from "lucide-react";

const STARTERS = [
  "Our in-house system is aging and everyone's afraid to touch it",
  "My team wastes hours on manual data entry",
  "I'm worried our customer data isn't locked down",
  "Customers can't find us on Google",
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
        Tell me what&apos;s not working.
      </h2>
      <p className="mt-1 max-w-[260px] text-sm text-[var(--color-text-secondary)]">
        Describe what&apos;s going on with your site, system, or process, and
        I&apos;ll show you how Joshua would fix it.
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

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "brand" | "warm";
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  const tones: Record<string, string> = {
    neutral:
      "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] border border-[var(--color-border)]",
    brand:
      "bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]",
    warm:
      "bg-[var(--color-accent-warm-100)] text-[var(--color-accent-warm-dark)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wide",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

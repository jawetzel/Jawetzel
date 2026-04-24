import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function SecurityAuditCard({ index }: { index: number }) {
  const accent = index % 2 === 0 ? "brand" : "warm";
  const highlights = [
    "Zero-knowledge methodology",
    "14 admin dashboards exposed",
    "Customer financials on public storage",
    "Wholesale cost on ~45K products",
    "Redacted report + downloadable PDF",
  ];

  return (
    <Link
      href="/security-audit"
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-[var(--color-brand-primary)] hover:shadow-[0_24px_48px_-16px_rgba(23,69,67,0.18)]"
    >
      <div
        className={`pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl transition-opacity duration-500 ${
          accent === "brand"
            ? "bg-[var(--color-brand-primary-100)] opacity-70 group-hover:opacity-100"
            : "bg-[var(--color-accent-warm-100)] opacity-70 group-hover:opacity-100"
        }`}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
              Case study · 0{index + 1}
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold tracking-tight md:text-3xl">
              Security audit
            </h3>
          </div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] transition group-hover:rotate-45 group-hover:border-[var(--color-brand-primary)] group-hover:bg-[var(--color-brand-primary)] group-hover:text-[var(--color-brand-primary-deep)]">
          <ArrowUpRight size={18} />
        </span>
      </div>

      <p className="relative mt-3 text-[var(--color-text-secondary)]">
        Zero-knowledge audit of a mid-size B2B distributor — 14 unauthenticated
        dashboards, customer financials, and wholesale pricing on ~45K
        products, all served without a login.
      </p>

      <div className="relative mt-6 flex flex-wrap gap-2">
        {highlights.map((h) => (
          <Badge key={h} tone="neutral">
            {h}
          </Badge>
        ))}
      </div>
    </Link>
  );
}

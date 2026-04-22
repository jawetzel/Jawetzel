import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Tools",
  description:
    "Live tools and APIs I publish — try them in the browser or hit them programmatically.",
};

type Tool = {
  href: string;
  name: string;
  tagline: string;
  tags: string[];
};

const tools: Tool[] = [
  {
    href: "/embroidery",
    name: "Embroidery",
    tagline:
      "Image → machine-ready stitches. AI pipeline that turns a regular image into a production embroidery file — palette-matched, inked, and ready for your machine.",
    tags: ["AI", "Image pipeline", "API + UI"],
  },
];

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <SectionHeader
        eyebrow="Tools & APIs"
        title="Things you can actually use."
        description="Small, focused tools and APIs I publish. Each one is live — open it in the browser, or wire it into your own stack."
      />

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {tools.map((t, i) => (
          <ToolCard key={t.href} tool={t} index={i} />
        ))}
      </div>
    </div>
  );
}

function ToolCard({ tool, index }: { tool: Tool; index: number }) {
  const accent = index % 2 === 0 ? "brand" : "warm";
  return (
    <Link
      href={tool.href}
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
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
            Tool · 0{index + 1}
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold tracking-tight md:text-3xl">
            {tool.name}
          </h3>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] transition group-hover:rotate-45 group-hover:border-[var(--color-brand-primary)] group-hover:bg-[var(--color-brand-primary)] group-hover:text-[var(--color-brand-primary-deep)]">
          <ArrowUpRight size={18} />
        </span>
      </div>

      <p className="relative mt-3 text-[var(--color-text-secondary)]">
        {tool.tagline}
      </p>

      <div className="relative mt-6 flex flex-wrap gap-2">
        {tool.tags.map((t) => (
          <Badge key={t} tone="neutral">
            {t}
          </Badge>
        ))}
      </div>
    </Link>
  );
}

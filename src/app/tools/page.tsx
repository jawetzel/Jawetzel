import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { pageMetadata } from "@/lib/seo";
import {
  JsonLd,
  breadcrumbSchema,
  collectionPageSchema,
} from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Tools",
  description:
    "Live tools and APIs I publish. Try them in the browser or call them programmatically.",
  path: "/tools",
});

type Tool = {
  href: string;
  name: string;
  tagline: string;
  tags: string[];
  external?: boolean;
};

const tools: Tool[] = [
  {
    href: "/embroidery",
    name: "Embroidery",
    tagline:
      "Image → machine-ready stitches. An AI pipeline that turns a regular image into a production embroidery file, palette-matched against a real thread catalog and ready to load into a machine.",
    tags: ["AI", "Image pipeline", "API + UI"],
  },
  {
    href: "/tools/embroidery-supplies",
    name: "Embroidery supplies",
    tagline:
      "Pricing and quantity comparison feed for embroidery thread, stabilizer, and blanks. Normalizes listings across vendors so the per-unit cost is directly comparable.",
    tags: ["Pricing", "Comparison", "Feed"],
  },
  {
    href: "https://vorbiz.net",
    name: "Vorbiz",
    tagline:
      "A free POS tracker for booth and market vendors. Offline-first across multiple devices on iOS + Android, with sales-tax and revenue reports they hand to their accountant at filing time.",
    tags: ["Free for vendors", "iOS + Android", "Offline-first"],
    external: true,
  },
];

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([{ name: "Tools", path: "/tools" }]),
          collectionPageSchema({
            name: "Tools · Joshua Wetzel",
            description:
              "Live tools and APIs — try them in the browser or call them programmatically.",
            path: "/tools",
            items: tools.map((t) => ({
              name: t.name,
              path: t.href,
              description: t.tagline,
            })),
          }),
        ]}
      />
      <SectionHeader
        eyebrow="Tools & APIs"
        title="Live tools and APIs."
        description="Small, focused tools I publish — each one live and free. Browser UIs on top of HTTP APIs you can call, plus a native iOS + Android app for booth and market vendors."
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
  const cardClass =
    "group relative flex flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-[var(--color-brand-primary)] hover:shadow-[0_24px_48px_-16px_rgba(23,69,67,0.18)]";
  const inner = (
    <>
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
    </>
  );

  if (tool.external) {
    return (
      <a
        href={tool.href}
        target="_blank"
        rel="noopener"
        className={cardClass}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={tool.href} className={cardClass}>
      {inner}
    </Link>
  );
}

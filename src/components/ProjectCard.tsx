import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProjectCaseStudy } from "@/lib/projects";

export function ProjectCard({
  project,
  index,
}: {
  project: ProjectCaseStudy;
  index: number;
}) {
  const accent = index % 2 === 0 ? "brand" : "warm";
  return (
    <Link
      href={`/projects/${project.slug}`}
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
          {project.logo && (
            <Image
              src={project.logo}
              alt={`${project.name} logo`}
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-xl object-contain"
            />
          )}
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
              Case study · 0{index + 1}
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold tracking-tight md:text-3xl">
              {project.name}
            </h3>
          </div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] transition group-hover:rotate-45 group-hover:border-[var(--color-brand-primary)] group-hover:bg-[var(--color-brand-primary)] group-hover:text-[var(--color-brand-primary-deep)]">
          <ArrowUpRight size={18} />
        </span>
      </div>

      <p className="relative mt-3 text-[var(--color-text-secondary)]">
        {project.tagline}
      </p>

      <div className="relative mt-6 flex flex-wrap gap-2">
        {(project.highlights ?? project.stack).slice(0, 5).map((s) => (
          <Badge key={s} tone="neutral">
            {s}
          </Badge>
        ))}
        {(project.highlights ?? project.stack).length > 5 && (
          <Badge tone="neutral">
            +{(project.highlights ?? project.stack).length - 5}
          </Badge>
        )}
      </div>
    </Link>
  );
}

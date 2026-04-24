import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAllProjects, getProjectBySlug } from "@/lib/projects";
import { pageMetadata } from "@/lib/seo";
import {
  JsonLd,
  breadcrumbSchema,
  projectCaseStudySchema,
} from "@/lib/jsonld";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return getAllProjects().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) return { title: "Not found" };
  return pageMetadata({
    title: project.name,
    description: project.tagline,
    path: `/projects/${project.slug}`,
  });
}

export default async function ProjectDetailPage({ params }: Props) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) return notFound();

  const all = getAllProjects();
  const idx = all.findIndex((p) => p.slug === slug);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;

  return (
    <article className="mx-auto max-w-5xl px-4 pb-24 pt-12 md:px-6 md:pt-16">
      <JsonLd
        graph={[
          breadcrumbSchema([
            { name: "Work", path: "/projects" },
            { name: project.name, path: `/projects/${project.slug}` },
          ]),
          projectCaseStudySchema(project),
        ]}
      />
      <Link
        href="/projects"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        <ArrowLeft size={16} /> All projects
      </Link>

      {/* HEADER */}
      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-brand-primary-dark)]">
            Case study
          </p>
          {project.status && (
            <Badge tone={project.status === "live" ? "brand" : "neutral"}>
              {project.status}
            </Badge>
          )}
        </div>
        <div className="mt-4 flex items-center gap-5">
          {project.logo && (
            <Image
              src={project.logo}
              alt={`${project.name} logo`}
              width={96}
              height={96}
              className="h-16 w-16 shrink-0 rounded-2xl object-contain md:h-24 md:w-24"
            />
          )}
          <h1 className="font-display text-5xl font-black tracking-tight md:text-7xl">
            {project.name}
          </h1>
        </div>
        <p className="mt-4 max-w-3xl text-xl text-[var(--color-text-secondary)] md:text-2xl">
          {project.tagline}
        </p>

        {project.links && project.links.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {project.links.map((l) => (
              <Button key={l.href} asChild variant="outline" size="sm">
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="gap-2"
                >
                  {l.label} <ExternalLink size={14} />
                </a>
              </Button>
            ))}
          </div>
        )}
      </header>

      {/* HERO STRIPE */}
      <div className="relative mt-12 overflow-hidden rounded-[32px] border border-[var(--color-border)] bg-[var(--color-brand-primary)] p-10 md:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(23,69,67,0.25) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-[var(--color-accent-warm)] opacity-80"
        />
        <div className="relative">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-deep)]">
            The problem
          </p>
          <p className="mt-4 max-w-3xl font-display text-2xl leading-snug text-[var(--color-brand-primary-deep)] md:text-4xl">
            {project.problem}
          </p>
        </div>
      </div>

      {/* ACTIONS */}
      <section className="mt-20">
        <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          What I did
        </h2>
        <ol className="mt-10 space-y-10">
          {project.actions.map((a, i) => (
            <li
              key={i}
              className="grid gap-6 border-t border-[var(--color-border)] pt-8 md:grid-cols-[120px_1fr] md:gap-10"
            >
              <div className="font-display text-5xl font-black leading-none text-[var(--color-brand-primary)] md:text-6xl">
                0{i + 1}
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold tracking-tight md:text-2xl">
                  {a.title}
                </h3>
                <p className="mt-3 text-[var(--color-text-secondary)] md:text-lg">
                  {a.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* OUTCOME */}
      <section className="mt-20 rounded-3xl border border-[var(--color-border)] bg-[var(--color-brand-primary-50)] p-8 md:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
          The outcome
        </p>
        <p className="mt-4 max-w-3xl font-display text-2xl leading-snug md:text-3xl">
          {project.outcome}
        </p>
      </section>

      {/* UNDER THE HOOD */}
      <section className="mt-20 grid gap-10 md:grid-cols-[240px_1fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            Under the hood
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {project.stack.map((s) => (
              <Badge key={s} tone="neutral">
                {s}
              </Badge>
            ))}
          </div>
        </div>
        <p className="text-[var(--color-text-secondary)] md:text-lg">
          {project.underTheHood}
        </p>
      </section>

      {/* LINKS */}
      {project.links && project.links.length > 0 && (
        <section className="mt-16">
          <h3 className="font-display text-xl font-semibold">Links</h3>
          <ul className="mt-4 flex flex-wrap gap-3">
            {project.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-2 text-sm font-medium hover:border-[var(--color-brand-primary)]"
                >
                  {l.label} <ExternalLink size={14} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PREV/NEXT */}
      <nav className="mt-24 grid gap-4 border-t border-[var(--color-border)] pt-10 md:grid-cols-2">
        {prev ? (
          <Link
            href={`/projects/${prev.slug}`}
            className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 transition hover:border-[var(--color-brand-primary)]"
          >
            <p className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
              <ArrowLeft size={14} /> Previous
            </p>
            <p className="mt-2 font-display text-lg font-semibold">
              {prev.name}
            </p>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            href={`/projects/${next.slug}`}
            className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 text-right transition hover:border-[var(--color-brand-primary)]"
          >
            <p className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
              Next <ArrowRight size={14} />
            </p>
            <p className="mt-2 font-display text-lg font-semibold">
              {next.name}
            </p>
          </Link>
        ) : (
          <div />
        )}
      </nav>
    </article>
  );
}

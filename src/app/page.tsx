import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectCard } from "@/components/ProjectCard";
import { SecurityAuditCard } from "@/components/SecurityAuditCard";
import { SectionHeader } from "@/components/SectionHeader";
import { Marquee } from "@/components/Marquee";
import { getFeaturedProjects } from "@/lib/projects";
import { getAllPosts } from "@/lib/blog";
import { getTestimonials } from "@/lib/testimonials";
import { getMarqueeItems } from "@/lib/marquee";
import { readingTimeMinutes } from "@/lib/markdown";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Joshua Wetzel",
    title: "Joshua Wetzel — Full-stack dev",
    description:
      "Full-stack developer. 6+ yrs. Legacy modernization. AI-native tooling. Solo-shipped products.",
    url: "/",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Joshua Wetzel — Full-stack dev",
    description:
      "Full-stack developer. 6+ yrs. Legacy modernization. AI-native tooling. Solo-shipped products.",
    images: ["/opengraph-image"],
  },
};

const SOLUTIONS: Array<{
  title: string;
  body: string;
  href: string;
  cta: string;
}> = [
  {
    title: "AI-assisted workflows",
    body: "AI baked into the workflow your users already do — photo pre-fill, inline audits, bulk repair. Not a chatbot bolted on.",
    href: "/projects/cookjunkie",
    cta: "Read the case",
  },
  {
    title: "Payments & Stripe Connect",
    body: "Direct charges or full marketplace — autopay, app fees, chargeback auto-block, idempotent webhooks.",
    href: "/projects/tutortab",
    cta: "Read the case",
  },
  {
    title: "Booking & scheduling",
    body: "Self-serve booking pages, two-way calendar sync, availability windows, deduped reminder cascades.",
    href: "https://tutortab.net/joshua-wetzel",
    cta: "See it live",
  },
  {
    title: "Accessibility audit + fixes",
    body: "WCAG 2.1 AA pass — keyboard nav, color contrast, alt text, screen-reader smooth. Cuts ADA lawsuit risk.",
    href: "/contact",
    cta: "Get a quote",
  },
  {
    title: "Security hardening",
    body: "CSP with nonces, HSTS, rate limits, edge bot-blocking, JS challenge. The audit-pass-on-day-one kind.",
    href: "/security-audit",
    cta: "See the audit",
  },
  {
    title: "WordPress → modern stack",
    body: "URL-preserving cutover, AI-repaired legacy data, modern infra without losing organic search.",
    href: "/projects/cookjunkie",
    cta: "Read the case",
  },
];

export default function HomePage() {
  const projects = getFeaturedProjects();
  const latestPost = getAllPosts()[0];
  const testimonials = getTestimonials();
  const marqueeItems = getMarqueeItems();

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="hero-dots pointer-events-none absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-[-20%] top-[-10%] h-[520px] w-[520px] rounded-full bg-[var(--color-brand-primary-100)] blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-[-10%] top-[20%] h-[380px] w-[380px] rounded-full bg-[var(--color-accent-warm-100)] blur-[120px]"
        />

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 md:px-6 md:pb-28 md:pt-20">
          <div className="fade-up inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-brand-primary)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-brand-primary-dark)]" />
            </span>
            Taking on one new engagement this quarter
          </div>

          <h1 className="fade-up mt-6 font-display text-[clamp(2.5rem,7vw,5.5rem)] font-black leading-[0.98] tracking-tight">
            Shipping software{" "}
            <span className="relative inline-block">
              <span className="relative z-10">that earns its keep</span>
              <svg
                aria-hidden
                viewBox="0 0 320 16"
                className="absolute -bottom-1 left-0 h-3 w-full text-[var(--color-brand-primary)]"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 8 C 80 2, 160 14, 318 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <br />
            for{" "}
            <span className="italic text-[var(--color-brand-primary-dark)]">
              six&nbsp;years
            </span>
            &nbsp;and counting.
          </h1>

          <p
            className="fade-up mt-6 max-w-2xl text-lg text-[var(--color-text-secondary)] md:text-xl"
            style={{ animationDelay: "80ms" }}
          >
            I&apos;m Joshua — a full-stack developer. I modernize legacy
            systems, ship solo products end-to-end, and build ops tooling
            around AI agents. The projects below are in production.
          </p>

          <div
            className="fade-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "160ms" }}
          >
            <Button asChild variant="primary" size="lg">
              <Link href="/contact">
                Let&apos;s talk about your project
                <ArrowRight size={18} />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/projects">See the work</Link>
            </Button>
          </div>

          <div
            className="fade-up mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--color-text-muted)]"
            style={{ animationDelay: "240ms" }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-primary)]" />
              .NET Core · Node · Next.js
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-warm)]" />
              Remote-proven
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-primary)]" />
              Greater Baton Rouge, LA
            </span>
          </div>
        </div>

      </section>

      {/* SOLUTIONS STRIP */}
      <section className="relative overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-brand-primary-deep)] text-[var(--color-text-inverse)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(84,217,211,0.25) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary)]">
            What I build
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-bold leading-tight md:text-5xl">
            Six things I&apos;ll happily quote on{" "}
            <span className="text-[var(--color-brand-primary)]">this week</span>
            .
          </h2>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {SOLUTIONS.map((s, i) => {
              const num = String(i + 1).padStart(2, "0");
              const isExternal = s.href.startsWith("http");
              const cardClass =
                "group relative flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:-translate-y-1 hover:border-white/25 hover:bg-white/10";
              const inner = (
                <>
                  <div className="font-mono text-sm font-semibold text-[var(--color-brand-primary)]">
                    {num}
                  </div>
                  <h3 className="mt-3 font-display text-xl font-semibold leading-tight">
                    {s.title}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--color-surface-muted)]">
                    {s.body}
                  </p>
                  <div className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-brand-primary)] transition group-hover:gap-2.5">
                    {s.cta}
                    {isExternal ? (
                      <ExternalLink size={12} />
                    ) : (
                      <ArrowRight size={12} />
                    )}
                  </div>
                </>
              );
              return isExternal ? (
                <a
                  key={s.title}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cardClass}
                >
                  {inner}
                </a>
              ) : (
                <Link key={s.title} href={s.href} className={cardClass}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* FEATURED WORK */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <SectionHeader
            eyebrow="Selected work"
            title="Four products, one field report."
            description="Each case study starts with the problem it solved. The stack sits in the margin."
          />
          <Button asChild variant="ghost" size="sm">
            <Link href="/projects" className="gap-2">
              All projects <ArrowRight size={16} />
            </Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {projects[0] && <ProjectCard key={projects[0].slug} project={projects[0]} index={0} />}
          <SecurityAuditCard index={1} />
          {projects.slice(1).map((p, i) => (
            <ProjectCard key={p.slug} project={p} index={i + 2} />
          ))}
        </div>
      </section>

      {/* MARQUEE */}
      <section className="relative border-y border-[var(--color-border)] bg-[var(--color-surface-muted)] py-4">
        <Marquee items={marqueeItems} />
      </section>

      {/* TESTIMONIAL + BLOG TEASE */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="grid gap-10 md:grid-cols-5 md:gap-16">
          {testimonials.length > 0 && (
            <div className="md:col-span-3">
              <SectionHeader eyebrow="Receipts" title="What clients say" />
              <div className="mt-8 space-y-6">
                {testimonials.map((t, i) => (
                  <figure
                    key={i}
                    className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-7 shadow-sm"
                  >
                    <blockquote className="font-display text-xl leading-relaxed md:text-2xl">
                      &ldquo;{t.quote}&rdquo;
                    </blockquote>
                    <figcaption className="mt-5 text-sm">
                      <span className="font-semibold">{t.name}</span>
                      {t.role && (
                        <span className="text-[var(--color-text-secondary)]">
                          {" — "}
                          {t.role}
                          {t.company ? `, ${t.company}` : ""}
                        </span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {latestPost && (
            <div className="md:col-span-2">
              <SectionHeader eyebrow="From the lab notebook" title="Latest post" />
              <Link
                href={`/blog/${latestPost.slug}`}
                className="mt-8 block rounded-3xl border border-[var(--color-border)] bg-[var(--color-brand-primary-50)] p-7 transition hover:-translate-y-1 hover:border-[var(--color-brand-primary)]"
              >
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-brand-primary-dark)]">
                  <Sparkles size={12} /> {latestPost.kind}
                  <span>·</span>
                  <span>{readingTimeMinutes(latestPost.bodyMd)} min read</span>
                </div>
                <h3 className="mt-3 font-display text-xl font-semibold tracking-tight md:text-2xl">
                  {latestPost.title}
                </h3>
                <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                  {latestPost.description}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {latestPost.tags.slice(0, 3).map((t) => (
                    <Badge key={t} tone="brand">
                      {t}
                    </Badge>
                  ))}
                </div>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 md:px-6">
        <div className="relative overflow-hidden rounded-[32px] bg-[var(--color-brand-primary)] p-10 text-center md:p-16">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-[var(--color-accent-warm)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-20 -left-10 h-60 w-60 rounded-full border-[10px] border-[var(--color-brand-primary-deep)] opacity-20"
          />
          <div className="relative">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-deep)]">
              ↓ Next step
            </p>
            <h2 className="mt-4 font-display text-4xl font-black tracking-tight text-[var(--color-brand-primary-deep)] md:text-6xl">
              Got something gnarly?
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--color-text-primary)]">
              Tell me what you&apos;re working on and what&apos;s stuck. I read
              every inquiry personally.
            </p>
            <div className="mt-8">
              <Button asChild variant="primary" size="lg">
                <Link href="/contact">
                  Start the conversation <ArrowRight size={18} />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}


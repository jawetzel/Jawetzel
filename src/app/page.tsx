import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/ProjectCard";
import { SecurityAuditCard } from "@/components/SecurityAuditCard";
import { SectionHeader } from "@/components/SectionHeader";
import { createContentContainer } from "@/composition/content";
import { SITE } from "@/lib/constants";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Joshua Wetzel",
    title: "Joshua Wetzel — Legacy Application Modernization",
    description:
      "Legacy application modernization & software consulting in Greater Baton Rouge, LA. 6+ yrs modernizing the mission-critical legacy systems a business runs on, plus AI-native tooling and solo-shipped products. On-site across South Louisiana, remote nationwide.",
    url: "/",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Joshua Wetzel — Legacy Application Modernization",
    description:
      "Legacy application modernization & software consulting in Greater Baton Rouge, LA. 6+ yrs modernizing mission-critical legacy systems, plus AI-native tooling.",
    images: ["/opengraph-image"],
  },
};

const OFFERS: Array<{ title: string; body: string }> = [
  {
    title: "Legacy Modernization",
    body: "Legacy application modernization for the systems a business actually runs on — billing, scheduling, compliance, the customer portal. I bring aging .NET, Node, and SQL up to modern, maintainable footing, incrementally, without a risky big-bang rewrite.",
  },
  {
    title: "Fractional Engineer",
    body: "The senior engineer for a company that doesn't have one. You run on custom software but can't justify a full-time developer — so I take the role part-time.",
  },
  {
    title: "AI Integration",
    body: "AI built into the tools your team already uses — pre-filling forms from a photo, flagging issues inline, repairing data in bulk.",
  },
  {
    title: "Security Review",
    body: "A clear answer to \"are we actually safe?\" I check where your systems are exposed and where an attacker could get in, then hand you a written report and the fixes to close each gap.",
  },
  {
    title: "SEO Enhancement",
    body: "I run your pages through an analysis engine I built, then hand you a prioritized list of what's holding your rankings back.",
  },
];

// Testimonials are gated off for now — flip to true to bring the
// "What clients say" section back on the homepage.
const SHOW_TESTIMONIALS = false;

export default async function HomePage() {
  const content = createContentContainer();
  const projects = await content.getFeaturedProjects.execute();
  const testimonials = await content.getTestimonials.execute();

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
            I&apos;m Joshua — a software consultant in the Greater
            Baton Rouge area. I modernize legacy systems, ship solo products
            end-to-end, and build the operational tooling in between. The
            projects below are in production.
          </p>

          <div
            className="fade-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "160ms" }}
          >
            <Button asChild variant="primary" size="lg">
              <a href={SITE.calendly} target="_blank" rel="noreferrer">
                Book a free consult
                <ArrowRight size={18} />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/projects">See the work</Link>
            </Button>
          </div>
          <p
            className="fade-up mt-3 text-sm text-[var(--color-text-muted)]"
            style={{ animationDelay: "200ms" }}
          >
            First conversation is on me — no invoice, no hard pitch.
          </p>

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
              Production-grade
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
            What I do
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-bold leading-tight md:text-5xl">
            Five ways I{" "}
            <span className="text-[var(--color-brand-primary)]">plug in</span>
            .
          </h2>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {OFFERS.map((s, i) => {
              const num = String(i + 1).padStart(2, "0");
              return (
                <div
                  key={s.title}
                  className="relative flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6"
                >
                  <div className="font-mono text-sm font-semibold text-[var(--color-brand-primary)]">
                    {num}
                  </div>
                  <h3 className="mt-3 font-display text-xl font-semibold leading-tight">
                    {s.title}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--color-surface-muted)]">
                    {s.body}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-4">
            <a
              href={SITE.calendly}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-primary)] px-6 py-3 text-sm font-semibold text-[var(--color-brand-primary-deep)] transition hover:bg-white"
            >
              Book a meeting <ArrowRight size={16} />
            </a>
            <span className="text-sm text-[var(--color-surface-muted)]">
              Not sure which one you need? Ask me on the call.
            </span>
          </div>
        </div>
      </section>

      {/* WHO I WORK WITH */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="grid gap-12 md:grid-cols-[1.1fr_1fr] md:gap-16">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
              Who I work with
            </p>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight md:text-5xl">
              Operators whose software is{" "}
              <span className="italic text-[var(--color-brand-primary-dark)]">
                running the company
              </span>
              .
            </h2>
            <p className="mt-6 text-lg text-[var(--color-text-secondary)]">
              The sweet spot is a team where the in-house system is
              load-bearing — billing, scheduling, dispatch, compliance, the
              customer portal — and aging fast enough that everyone knows
              it. I&apos;ve spent six years inside those rooms as the only
              engineer, so I price and ship like one.
            </p>

            <ul className="mt-8 space-y-3 text-[var(--color-text-primary)]">
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                <span>
                  <span className="font-semibold">Your problem, start to finish.</span>{" "}
                  You bring the problem; I scope it, build it, and stay on it
                  after it ships.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-accent-warm)]" />
                <span>
                  <span className="font-semibold">A real person nearby.</span>{" "}
                  I&apos;m local to South Louisiana, so there&apos;s someone you
                  can actually reach and meet in person when it matters.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                <span>
                  <span className="font-semibold">No agency layer.</span>{" "}
                  You work directly with the developer building it, so
                  decisions don&apos;t wait on a middleman.
                </span>
              </li>
            </ul>

            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-2 text-sm">
              <MapPin size={14} className="text-[var(--color-brand-primary-dark)]" />
              <span className="text-[var(--color-text-secondary)]">
                Based in Prairieville, LA · serving South Louisiana &
                nationwide
              </span>
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-7 md:p-9">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)]">
              Industries I&apos;ve shipped into
            </p>
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm text-[var(--color-text-primary)]">
              {[
                "Distribution & wholesale",
                "Compliance & regulated ops",
                "Healthcare-adjacent SaaS",
                "Field service & dispatch",
                "Education & tutoring",
                "Hospitality & food",
                "Marketplaces & multi-vendor",
                "Retail & POS",
              ].map((industry) => (
                <li key={industry} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                  <span>{industry}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 border-t border-[var(--color-border)] pt-6">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)]">
                What clients tend to bring me
              </p>
              <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
                <li>· An aging in-house system the team has outgrown</li>
                <li>· A new product to ship before someone else does</li>
                <li>· An integration or automation that has to hold up in production</li>
                <li>· A security finding that needs to be fixed quietly</li>
              </ul>
            </div>

            <div className="mt-8">
              <Link
                href="/baton-rouge-software-developer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-primary-dark)] hover:gap-2.5"
              >
                For Baton Rouge–area businesses{" "}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED WORK */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <SectionHeader
            eyebrow="Selected work"
            title="What I've shipped."
            description="Each one starts with the problem it solved."
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

      {/* TESTIMONIALS — hidden; flip SHOW_TESTIMONIALS to restore */}
      {SHOW_TESTIMONIALS && testimonials.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader eyebrow="Receipts" title="What clients say" />
          <div className="mt-8 grid max-w-3xl gap-6">
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
        </section>
      )}

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
              Tell me what you&apos;re working on and what&apos;s stuck. The
              first call is free — 30 minutes, no invoice, no
              high-pressure pitch.
            </p>
            <div className="mt-8">
              <Button asChild variant="primary" size="lg">
                <a href={SITE.calendly} target="_blank" rel="noreferrer">
                  Book a free consult <ArrowRight size={18} />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}


import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Accessibility,
  ArrowRight,
  Bot,
  Boxes,
  FileSearch,
  MapPin,
  Search,
  Server,
  ShieldCheck,
  Wrench,
} from "lucide-react";
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
    title: "Joshua Wetzel · Software Reviews & Engineering Blocks",
    description:
      "Software consulting in Greater Baton Rouge. A review that finds what's wrong with your site or system, and a focused block of engineering to fix it. Legacy modernization, automation, and AI integration.",
    url: "/",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Joshua Wetzel · Software Reviews & Engineering Blocks",
    description:
      "A review that finds what's wrong, and a focused block of engineering to fix it. Software consulting in Greater Baton Rouge: legacy modernization, automation, AI.",
    images: ["/opengraph-image"],
  },
};

// The Review product — one offer, pick a lens.
const REVIEW_LENSES: Array<{ icon: ReactNode; name: string; q: string }> = [
  {
    icon: <ShieldCheck size={15} />,
    name: "Security",
    q: "Am I leaking data I shouldn't be?",
  },
  {
    icon: <Search size={15} />,
    name: "SEO",
    q: "Do search engines and AI engines trust me?",
  },
  {
    icon: <Accessibility size={15} />,
    name: "Accessibility",
    q: "Are customers struggling, and could that get me sued?",
  },
  {
    icon: <FileSearch size={15} />,
    name: "Legacy Assessment",
    q: "Is my aging app worth saving, and how?",
  },
];

// What a block gets spent on — examples that make the abstract block concrete.
// Not a menu of separate offers; all one SKU, aimed at different problems.
const BLOCK_WORK: Array<{
  icon: ReactNode;
  title: string;
  body: string;
  flagship?: boolean;
}> = [
  {
    icon: <Server size={18} />,
    title: "Legacy modernization",
    flagship: true,
    body: "For the system that's old, slow, and expensive to host. I bring it up to date in slices rather than one giant rewrite, so it keeps running the whole way through.",
  },
  {
    icon: <Bot size={18} />,
    title: "Process automation & AI",
    body: "That task your team does 40 times a day? I build an automation to handle it, with a dry-run mode and human review so it can't break production without anyone noticing.",
  },
  {
    icon: <Wrench size={18} />,
    title: "Close the gaps",
    body: "The security, SEO, and accessibility problems your review turned up, fixed and verified. I ship the fixes myself instead of handing you a report, and your review fee counts toward the block.",
  },
  {
    icon: <Boxes size={18} />,
    title: "Integrations & glue",
    body: "Get two systems talking to each other: payments, ERPs, calendars, and whatever API sits between them.",
  },
];

// Cost of waiting — the honest urgency. Mirrors the review lenses.
const WHY_NOW: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <ShieldCheck size={18} />,
    title: "Exposure doesn't fix itself",
    body: "Leaked keys, open admin panels, customer data in the page source. All of it sits in the open until someone finds it, and you don't get to pick who.",
  },
  {
    icon: <Search size={18} />,
    title: "You can't see the traffic you're losing",
    body: "If search engines and AI tools can't read or trust your site, the customers they would have sent you end up somewhere else, and nothing tells you it happened.",
  },
  {
    icon: <Accessibility size={18} />,
    title: "A demand letter costs more than the fix",
    body: "Website accessibility complaints are a growing, well-funded cottage industry. Closing the gaps costs a fraction of answering one.",
  },
  {
    icon: <Server size={18} />,
    title: "Old systems only get more expensive",
    body: "Hosting costs creep up, changes take longer, and the migration you'll eventually need gets bigger the longer you wait.",
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
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-primary)]" />
            One problem at a time
          </div>

          <h1 className="fade-up mt-6 max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] font-black leading-[1.05] tracking-tight">
            Software problems,{" "}
            <span className="relative inline-block">
              <span className="relative z-10">found and fixed</span>
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
            .
          </h1>

          <p
            className="fade-up mt-6 max-w-2xl text-lg text-[var(--color-text-secondary)] md:text-xl"
            style={{ animationDelay: "80ms" }}
          >
            I&apos;m Joshua, a software consultant in the Greater Baton Rouge
            area. There are two ways to work with me: a{" "}
            <span className="font-semibold text-[var(--color-text-primary)]">
              review
            </span>{" "}
            that finds what&apos;s wrong with your site or system, and a
            focused{" "}
            <span className="font-semibold text-[var(--color-text-primary)]">
              block of engineering
            </span>{" "}
            to fix it.
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
              <Link href="/security-review">See a real review</Link>
            </Button>
          </div>
          <p
            className="fade-up mt-3 text-sm text-[var(--color-text-muted)]"
            style={{ animationDelay: "200ms" }}
          >
            The first conversation is free, and there&apos;s no hard pitch.
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

      {/* THE OFFER — two SKUs + the funnel */}
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
            How it works
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-bold leading-tight md:text-5xl">
            A review to{" "}
            <span className="text-[var(--color-brand-primary)]">find it</span>. A
            block to <span className="text-[var(--color-brand-primary)]">fix it</span>.
          </h2>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {/* Review card */}
            <div className="relative flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-[var(--color-brand-primary)]">
                  01 · Find it
                </span>
                <span className="font-display text-2xl font-black">$500</span>
              </div>
              <h3 className="mt-3 font-display text-2xl font-semibold leading-tight">
                The Review
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-surface-muted)]">
                A focused review that answers one question. Pick the one
                you&apos;re worried about:
              </p>

              <ul className="mt-5 space-y-2.5">
                {REVIEW_LENSES.map((lens) => (
                  <li key={lens.name} className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[var(--color-brand-primary)]">
                      {lens.icon}
                    </span>
                    <span className="text-sm">
                      <span className="font-semibold">{lens.name}</span>
                      <span className="text-[var(--color-surface-muted)]">
                        {": "}
                        {lens.q}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-xs leading-relaxed text-[var(--color-surface-muted)]">
                This isn&apos;t a 1,500-page automated scan. I look for the
                problems that repeat on every page, because fixing the template
                fixes them everywhere. You get a written report and a
                prioritized list.
              </p>

              <div className="mt-6 border-t border-white/10 pt-5">
                <Link
                  href="/security-review"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-primary)] transition hover:gap-2.5"
                >
                  See a real review <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            {/* Block card */}
            <div className="relative flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-[var(--color-brand-primary)]">
                  02 · Fix it
                </span>
                <span className="font-display text-2xl font-black">$1,000</span>
              </div>
              <h3 className="mt-3 font-display text-2xl font-semibold leading-tight">
                The Block
              </h3>
              <p className="mt-1 text-sm font-medium text-[var(--color-brand-primary)]">
                10 hours of senior engineering, aimed at one specific thing.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-surface-muted)]">
                Buy one when you need it. Big jobs like modernizing an aging
                system run as a{" "}
                <span className="font-semibold text-white">
                  sequence of blocks
                </span>
                : one slice at a time, and you can stop after any of them.
              </p>

              <ul className="mt-5 space-y-2 text-sm text-[var(--color-surface-muted)]">
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                  You bring a specific problem. I scope it, build it, and ship it.
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                  You work directly with the developer writing the code, with
                  no account manager in between.
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                  I&apos;m local to South Louisiana, and I work remotely with
                  clients everywhere else.
                </li>
              </ul>

              <div className="mt-6 border-t border-white/10 pt-5">
                <Link
                  href="#what-a-block-does"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-primary)] transition hover:gap-2.5"
                >
                  What a block is for <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>

          {/* The funnel line */}
          <div className="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-[var(--color-surface-muted)] md:text-base">
              The review finds the problems and the block fixes them. What you
              paid for the review{" "}
              <span className="font-semibold text-white">
                comes off your first block
              </span>
              .
            </p>
            <a
              href={SITE.calendly}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--color-brand-primary)] px-6 py-3 text-sm font-semibold text-[var(--color-brand-primary-deep)] transition hover:bg-white"
            >
              Book a free consult <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* WHAT A BLOCK DOES — work categories */}
      <section
        id="what-a-block-does"
        className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 md:px-6 md:py-28"
      >
        <SectionHeader
          eyebrow="What a block is for"
          title="What people spend a block on."
          description="A block is ten hours of engineering pointed at one problem. Here's where most of them get spent."
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {BLOCK_WORK.map((w) => (
            <div
              key={w.title}
              className="relative flex flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-7"
            >
              {w.flagship && (
                <span className="absolute right-5 top-5 rounded-full bg-[var(--color-brand-primary-100)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-brand-primary-deep)]">
                  Most common
                </span>
              )}
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
                {w.icon}
              </span>
              <h3 className="mt-5 font-display text-xl font-semibold tracking-tight">
                {w.title}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {w.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* WHY NOW — cost of waiting */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader
            eyebrow="Why not later"
            title="The longer it sits, the more it costs."
            description="None of these problems get better on their own. Here's what waiting on each one costs."
          />

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {WHY_NOW.map((item) => (
              <div
                key={item.title}
                className="flex gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-warm-100)] text-[var(--color-accent-warm-dark)]">
                  {item.icon}
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <Button asChild variant="primary" size="lg">
              <a href={SITE.calendly} target="_blank" rel="noreferrer">
                Start with a review <ArrowRight size={18} />
              </a>
            </Button>
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
              The sweet spot is a company that runs on an in-house system:
              billing, scheduling, dispatch, compliance, the customer portal.
              It still works, but it&apos;s aging, and everybody knows it.
              I&apos;ve spent six years as the only engineer inside companies
              like that, so I price and ship like one.
            </p>

            <ul className="mt-8 space-y-3 text-[var(--color-text-primary)]">
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                <span>
                  <span className="font-semibold">Your problem, start to finish.</span>{" "}
                  You bring the problem. I see it through from scoping to
                  shipping, and I stay on it after launch.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-accent-warm)]" />
                <span>
                  <span className="font-semibold">A real person nearby.</span>{" "}
                  I&apos;m local to South Louisiana, so there&apos;s someone you
                  can actually call and meet face to face.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                <span>
                  <span className="font-semibold">No agency in the middle.</span>{" "}
                  You work directly with the developer building it, so
                  decisions get made in one conversation.
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
                For Baton Rouge-area businesses{" "}
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
                      {" · "}
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
              Not sure where to start?
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--color-text-primary)]">
              Start with a review and you&apos;ll get a straight answer about
              where you stand. The report is yours to keep either way. Or just
              tell me what&apos;s stuck. The first call is free: 30 minutes,
              and nobody tries to sell you anything.
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

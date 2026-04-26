import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Clock,
  ExternalLink,
  Handshake,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/ProjectCard";
import { SecurityAuditCard } from "@/components/SecurityAuditCard";
import { SectionHeader } from "@/components/SectionHeader";
import { Marquee } from "@/components/Marquee";
import { getFeaturedProjects } from "@/lib/projects";
import { getMarqueeItems } from "@/lib/marquee";
import { getTestimonials } from "@/lib/testimonials";
import { pageMetadata } from "@/lib/seo";
import {
  JsonLd,
  breadcrumbSchema,
  professionalServiceSchema,
} from "@/lib/jsonld";
import { SITE } from "@/lib/constants";

export const metadata = pageMetadata({
  title: "Baton Rouge Software Developer",
  description:
    "Independent software developer in Prairieville, LA building custom Baton Rouge websites and web applications. Free initial consultation. A different option than the typical web design or IT shop — you're hiring the developer, not the agency. Serving Baton Rouge, Prairieville, St. George, Gonzales, and Denham Springs in person, and remote nationwide.",
  path: "/baton-rouge-software-developer",
});

const SERVICES: Array<{ title: string; body: string; href: string; cta: string }> = [
  {
    title: "Custom web app development",
    body: "Internal tools, customer portals, and back-office systems built on Next.js + .NET Core or Node. Production-grade from day one — auth, payments, audit trails included.",
    href: "/projects",
    cta: "See the builds",
  },
  {
    title: "Legacy system modernization",
    body: "Aging VB, classic ASP, or in-house .NET platforms migrated onto a modern stack — incrementally, without the cutover weekend that takes the company offline.",
    href: "/projects/cookjunkie",
    cta: "Read the case",
  },
  {
    title: "AI-assisted ops tooling",
    body: "AI baked into workflows your team already uses — pre-fill, audits, batch repair — wrapped in dry-run + review so an agent can't quietly break production.",
    href: "/projects/cookjunkie",
    cta: "Read the case",
  },
  {
    title: "Stripe & payments integration",
    body: "Subscriptions, marketplaces, autopay, app fees, chargeback auto-block, idempotent webhooks. The implementation that passes a real audit.",
    href: "/projects/tutortab",
    cta: "Read the case",
  },
  {
    title: "Security audits & hardening",
    body: "Zero-knowledge audit, written report, and concrete fixes. The same audit companies get blindsided by, done before your customer asks.",
    href: "/security-audit",
    cta: "See the audit",
  },
  {
    title: "Compliance & regulated workflows",
    body: "Six years inside a compliance platform — audit logs, role-based access, signed PDF deliverables, immutable history. The boring parts done right.",
    href: "/about",
    cta: "Why I know this",
  },
];

const SERVICE_CITIES: Array<{ name: string; note: string }> = [
  { name: "Prairieville", note: "home base" },
  { name: "St. George", note: "next door" },
  { name: "Gonzales", note: "10 min east" },
  { name: "Baton Rouge", note: "30 min to downtown" },
  { name: "Denham Springs", note: "25 min north" },
  { name: "Remote, US", note: "always available" },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Do you work on-site for Baton Rouge clients?",
    a: "Yes. For Baton Rouge, Prairieville, St. George, Gonzales, and Denham Springs I'm happy to do the kickoff, the cutover, and any in-person workshops on-site. The day-to-day build happens from my office in Prairieville so you're not paying for windshield time.",
  },
  {
    q: "How is this different from a Baton Rouge web design company?",
    a: "Web design and website design firms in Baton Rouge mostly do the front of the house — visual design, brand, content, the marketing site. That's a real craft and not what I do. I sit one layer deeper: the customer portal behind the login, the booking flow, the back-office tool, the integration with Stripe or your ERP. If you need both, the two roles work well alongside each other.",
  },
  {
    q: "What kind of company do you typically work with?",
    a: "Companies where the in-house system is load-bearing — billing, scheduling, dispatch, compliance, the customer portal — and where one developer who owns the whole thing is more useful than standing up a team. Big enough to need real software, small enough to move fast on it.",
  },
  {
    q: "What stack do you build on?",
    a: "Day-to-day: Next.js + TypeScript on the front end, .NET Core or Node on the back, MongoDB or PostgreSQL underneath, Stripe for payments, AWS or Railway for hosting. I use the stack that matches the problem, not the other way around.",
  },
  {
    q: "How are projects priced?",
    a: "Fixed-scope projects get a fixed price after a discovery conversation. Ongoing or modernization work is monthly retainer, scoped by what you actually need that month. No surprise invoices.",
  },
  {
    q: "How fast can you start?",
    a: "Currently taking on one new engagement per quarter. The contact form is the fastest way in — I read every inquiry personally and reply within a couple of business days.",
  },
  {
    q: "Is the consult actually free?",
    a: "Yes. The first conversation — usually 30 to 60 minutes, in person locally or over a call — is on me. I'll listen to what you're trying to do, ask the questions that matter, and tell you honestly whether it's a fit. If it isn't, I'll point you at someone who's a better match. No invoice, no auto-enrollment in a mailing list.",
  },
];

export default function BatonRougeDeveloperPage() {
  const projects = getFeaturedProjects();
  const testimonials = getTestimonials();
  const marqueeItems = getMarqueeItems();

  return (
    <>
      <JsonLd
        graph={[
          breadcrumbSchema([
            {
              name: "Baton Rouge Software Developer",
              path: "/baton-rouge-software-developer",
            },
          ]),
          professionalServiceSchema(),
          {
            "@type": "FAQPage",
            "@id": `${SITE.url}/baton-rouge-software-developer#faq`,
            mainEntity: FAQS.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          },
        ]}
      />

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
            <MapPin size={12} className="text-[var(--color-brand-primary-dark)]" />
            Prairieville, LA · serving Greater Baton Rouge & nationwide
          </div>

          <h1 className="fade-up mt-6 font-display text-[clamp(2.25rem,6vw,4.75rem)] font-black leading-[1.02] tracking-tight">
            A Baton Rouge software developer for the people who{" "}
            <span className="relative inline-block">
              <span className="relative z-10">actually need to ship</span>
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
            </span>{" "}
            something{" "}
            <span className="italic text-[var(--color-brand-primary-dark)]">
              real
            </span>
            .
          </h1>

          <p
            className="fade-up mt-6 max-w-2xl text-lg text-[var(--color-text-secondary)] md:text-xl"
            style={{ animationDelay: "80ms" }}
          >
            I&apos;m Joshua — an independent full-stack developer based in
            Prairieville. I build websites, web applications, and custom
            software for Baton Rouge–area operators — modernizing aging
            in-house systems, shipping net-new products, and adding the AI
            tooling that wraps around them. On-site for the kickoff and
            cutover, remote for the build.
          </p>

          <div
            className="fade-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "160ms" }}
          >
            <Button asChild variant="primary" size="lg">
              <Link href="/contact">
                Book a free consult <ArrowRight size={18} />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/projects">See the work</Link>
            </Button>
          </div>
          <p
            className="fade-up mt-3 text-sm text-[var(--color-text-muted)]"
            style={{ animationDelay: "200ms" }}
          >
            First conversation is on me — no invoice, no high-pressure pitch.
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
              6+ years in production
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-primary)]" />
              Solo dev — you hire me, not an agency
            </span>
          </div>
        </div>
      </section>

      {/* SERVICE AREA */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
          <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:items-start md:gap-14">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
                Service area
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold leading-tight md:text-4xl">
                On-site across the Baton Rouge metro.
              </h2>
              <p className="mt-4 text-[var(--color-text-secondary)] md:text-lg">
                Greater Baton Rouge is the in-person service area —
                Prairieville, St. George, Baton Rouge proper, Gonzales, and
                Denham Springs. Outside that radius the work runs remote, and
                that&apos;s fine: most of what I&apos;ve shipped has been
                remote anyway.
              </p>
              <div className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Clock size={14} />
                Typical reply: a couple of business days
              </div>
            </div>

            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-2">
              {SERVICE_CITIES.map((city) => (
                <li
                  key={city.name}
                  className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3"
                >
                  <span className="font-medium">{city.name}</span>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    {city.note}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className="relative overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-brand-primary-deep)] text-[var(--color-text-inverse)]">
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
            Software that{" "}
            <span className="text-[var(--color-brand-primary)]">runs the company</span>
            , done by the person writing it.
          </h2>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {SERVICES.map((s, i) => {
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

      {/* WHY HIRE LOCAL */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <SectionHeader
          eyebrow="Why local matters"
          title="Three things you only get from someone in the room."
          description="Not the only reasons to hire me — but the ones that change when you can drive to the same building."
        />

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-7">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
              <Building2 size={18} />
            </span>
            <h3 className="mt-5 font-display text-xl font-semibold tracking-tight">
              Kickoffs go faster in person
            </h3>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              The first conversation about a real system — the one where
              you&apos;re pointing at screens and explaining the workaround
              the night-shift folks use — is the conversation that decides
              the whole project. It&apos;s a lot easier in person.
            </p>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-7">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-warm-100)] text-[var(--color-accent-warm-dark)]">
              <Handshake size={18} />
            </span>
            <h3 className="mt-5 font-display text-xl font-semibold tracking-tight">
              Cutovers run smoother on-site
            </h3>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              When the new system goes live and the team has questions, being
              in the room for a day or two beats every Slack channel. I plan
              for that on local engagements.
            </p>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-7">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
              <ShieldCheck size={18} />
            </span>
            <h3 className="mt-5 font-display text-xl font-semibold tracking-tight">
              You can vet me before you wire money
            </h3>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              Coffee in Baton Rouge, a tour of your office, a hand-shake
              after — that&apos;s a different decision than hiring an
              overseas freelancer off a marketplace. The risk profile is
              just lower.
            </p>
          </div>
        </div>
      </section>

      {/* COMPARED TO */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader
            eyebrow="A different option"
            title="Not a web design agency. Not an IT company."
            description="If you've talked to a few Baton Rouge web design or IT shops and the fit isn't quite right, here's where I tend to land."
          />

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-7">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)]">
                vs. a web design shop
              </p>
              <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">
                Past the marketing site
              </h3>
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                Most Baton Rouge web design and website design firms do
                excellent brochure sites and brand work — that&apos;s their
                craft. I sit one layer deeper: the customer portal, the
                booking flow, the back-office tool, the integration with
                Stripe or your ERP. Different problem, different toolset.
                Hire whichever fits the job.
              </p>
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-7">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)]">
                vs. an IT services company
              </p>
              <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">
                Software, not networks
              </h3>
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                Baton Rouge IT companies are great at networks, helpdesk,
                Microsoft 365, and the box-of-cables side of running a
                business. Different specialty. I write the application your
                team uses every day — the thing the IT folks then keep
                online.
              </p>
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-7">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)]">
                vs. an offshore freelancer
              </p>
              <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">
                A name and a face
              </h3>
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                Cheaper hourly rates exist. They come with timezone gaps,
                turnover risk, and the work-product variance that&apos;s
                hard to vet from a marketplace listing. I&apos;m a half-hour
                from your office and have six years of production code you
                can read.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED WORK */}
      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <SectionHeader
              eyebrow="The work"
              title="Production code, real users."
              description="Each one I built end-to-end. Click through for the problem-to-outcome story on each."
            />
            <Button asChild variant="ghost" size="sm">
              <Link href="/projects" className="gap-2">
                All projects <ArrowRight size={16} />
              </Link>
            </Button>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {projects[0] && (
              <ProjectCard key={projects[0].slug} project={projects[0]} index={0} />
            )}
            <SecurityAuditCard index={1} />
            {projects.slice(1).map((p, i) => (
              <ProjectCard key={p.slug} project={p} index={i + 2} />
            ))}
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <section className="relative border-y border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-4">
        <Marquee items={marqueeItems} />
      </section>

      {/* TESTIMONIALS */}
      {testimonials.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader eyebrow="Receipts" title="What clients say" />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
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

      {/* FAQ */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="mx-auto max-w-4xl px-4 py-20 md:px-6 md:py-28">
          <SectionHeader
            eyebrow="Common questions"
            title="The things every prospect asks."
          />
          <div className="mt-10 space-y-4">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 open:shadow-sm"
              >
                <summary className="cursor-pointer list-none font-display text-lg font-semibold tracking-tight">
                  <span className="inline-flex items-center gap-2">
                    <Sparkles
                      size={14}
                      className="text-[var(--color-brand-primary-dark)] transition group-open:rotate-90"
                    />
                    {f.q}
                  </span>
                </summary>
                <p className="mt-3 text-[var(--color-text-secondary)]">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-20 md:px-6 md:pt-28">
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
              The first conversation is free.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--color-text-primary)]">
              Tell me what you&apos;re building and what&apos;s stuck. I read
              every inquiry personally, and the first call — 30 to 60 minutes
              — is on me. If it&apos;s a fit, we&apos;ll talk scope. If not,
              I&apos;ll point you somewhere better.
            </p>
            <div className="mt-8">
              <Button asChild variant="primary" size="lg">
                <Link href="/contact">
                  Book the consult <ArrowRight size={18} />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

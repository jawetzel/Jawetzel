import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, aboutPageSchema, breadcrumbSchema } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "About",
  description:
    "Joshua Wetzel — full-stack developer based in Greater Baton Rouge. Six-plus years modernizing legacy systems and shipping solo products.",
  path: "/about",
});

const doing = [
  "Legacy modernization — VB, classic ASP, and aging .NET surfaces migrated onto Next.js / .NET Core without downtime.",
  "Solo-scope SaaS builds, end-to-end — Stripe, auth, calendars, and the integrations in between.",
  "AI-native ops tooling — wrapping agents in dry-runnable, reviewable pipelines instead of letting them commit directly.",
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([{ name: "About", path: "/about" }]),
          aboutPageSchema(),
        ]}
      />
      <SectionHeader
        eyebrow="About"
        title="Hi, I'm Joshua."
        description="Full-stack developer based in Greater Baton Rouge. Six-plus years writing production code, most of it as the only engineer in the room."
      />

      {/* Avatar + intro */}
      <div className="mt-16 grid gap-12 md:grid-cols-[280px_1fr] md:items-start">
        <div className="order-2 md:order-1">
          <div className="relative mx-auto aspect-square w-48 md:w-full md:max-w-[280px]">
            <div
              aria-hidden
              className="absolute inset-0 rounded-full border-[6px] border-dashed border-[var(--color-brand-primary)] spin-slow"
            />
            <div className="absolute inset-3 overflow-hidden rounded-full bg-[var(--color-brand-primary)]">
              <Image
                src="/avatar.png"
                alt="Joshua Wetzel"
                fill
                sizes="(max-width: 768px) 12rem, 280px"
                className="object-contain"
                priority
              />
            </div>
            <div
              aria-hidden
              className="absolute -right-2 -top-2 h-10 w-10 rounded-full bg-[var(--color-accent-warm)]"
            />
          </div>
          <div className="mt-5 space-y-2 text-center text-sm md:text-left">
            <p className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)]">
              <MapPin size={14} /> Prairieville, LA · remote-proven
            </p>
          </div>
        </div>

        <div className="order-1 space-y-5 text-lg text-[var(--color-text-primary)] md:order-2">
          <p>
            I started coding in 2004, scripting video games. When I saw
            something a game didn&apos;t do, I wrote the thing that made it
            do it, and I never really stopped. By the time I got to
            Southeastern Louisiana for a Computer Science degree, the hobby
            had turned into a career path, and school pointed it toward
            business software.
          </p>
          <p>
            My first real job was at Lipsey&apos;s, a firearms distributor in
            Baton Rouge. I spent two years there on a full modernization of a
            large VB codebase onto .NET Core + React, covering both the
            customer-facing surface and the internal tools, rebuilt
            incrementally without taking the system offline. That shape of
            problem — an old system that still earns its keep, with real
            users on the other end, that needs to move forward without
            breaking — is the kind of work I kept going back to.
          </p>
          <p>
            Since late 2021 I&apos;ve been the sole developer on Fastlane, a
            compliance platform at Tri-Core. Full ownership across API, web,
            data model, and rollout — the only engineer in the codebase for
            four-plus years. In the margins, I&apos;ve shipped four solo
            products: a recipe site migrated off WordPress with a
            print-on-demand cookbook (
            <Link className="underline" href="/projects/cookjunkie">
              CookJunkie
            </Link>
            ), a pay-as-you-go scheduling SaaS for tutors (
            <Link className="underline" href="/projects/tutortab">
              TutorTab
            </Link>
            ), an offline-first POS for market vendors on both app stores (
            <Link className="underline" href="/projects/vorbiz">
              Vorbiz
            </Link>
            ), and a gardening content site with AI-assisted drafting (
            <Link className="underline" href="/projects/weekendplant">
              Weekend Plant
            </Link>
            ).
          </p>
          <p>
            I treat AI as a teammate you give narrow, well-specified tasks to,
            then review. Most of what I build with agents is the operational
            plumbing around them — the batching, the dry-run mode, the review
            step — rather than the model call itself.
          </p>
        </div>
      </div>

      {/* What I do / How I work */}
      <section className="mt-24 grid gap-10 md:grid-cols-2">
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-8">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            What I do
          </p>
          <ul className="mt-5 space-y-4">
            {doing.map((d) => (
              <li key={d} className="flex gap-3 text-[var(--color-text-primary)]">
                <span className="mt-2 h-1.5 w-4 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-8">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-accent-warm-dark)]">
            How I work
          </p>
          <div className="mt-5 space-y-4 text-[var(--color-text-primary)]">
            <p>
              The work usually starts with a conversation rather than a spec.
              Before I write anything, I want a clear picture of what
              you&apos;re trying to do and why you need it now.
            </p>
            <p>
              The answer isn&apos;t always more code. It can mean cutting
              scope, pushing back on an assumption, or realizing the real fix
              lives two layers below where we started. Once the shape is
              right, I build it and ship it.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mt-20 text-center">
        <h2 className="font-display text-3xl font-bold md:text-4xl">
          Want to talk about a project?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--color-text-secondary)]">
          I reply to every inquiry personally. Tell me what you&apos;re
          working on, and what&apos;s stuck.
        </p>
        <div className="mt-6">
          <Button asChild variant="primary" size="lg">
            <Link href="/contact">
              Start the conversation <ArrowRight size={18} />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

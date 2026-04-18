import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";

export const metadata: Metadata = {
  title: "About",
  description:
    "Joshua Wetzel — full-stack developer based in Greater Baton Rouge. Six-plus years modernizing legacy systems and shipping solo products.",
};

const doing = [
  "Legacy modernization — VB, classic ASP, and aging .NET surfaces into Next.js / .NET Core without downtime.",
  "Solo-scope SaaS builds — Stripe, auth, calendars, the messy integrations, end-to-end.",
  "AI-native ops tooling — wrapping agents in dry-runnable, reviewable pipelines instead of letting them commit directly.",
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
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
                className="object-contain p-4"
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
            I started writing production code in 2019, straight out of
            Southeastern Louisiana. The first job was modernizing a large VB
            surface onto .NET Core + React for a firearms distributor —
            incrementally, without taking the system offline. That shape of
            problem — an old system that still earns its keep, with real users,
            that needs to move forward without breaking — is the work I keep
            coming back to.
          </p>
          <p>
            For the last four-plus years I&apos;ve been the sole developer on a
            compliance platform at Tri-Core. Full ownership across API, web,
            data model, and rollout. In the margins, I&apos;ve shipped four
            solo products: a recipe site migrated off WordPress with a
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
            I don&apos;t think of AI as a party trick. I think of it as a
            teammate you give narrow, well-specified tasks to, then review
            their work. Most of what I build with agents is the ops tooling
            around them — the batching, the dry-run mode, the review step — not
            the model call itself. That&apos;s where the value lives.
          </p>
        </div>
      </div>

      {/* What I do */}
      <section className="mt-24">
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

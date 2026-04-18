import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { GithubIcon, LinkedinIcon } from "@/components/BrandIcons";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Tell me what you're working on. Inquiries go straight to my inbox — no CRM, no list, no autoresponder-except-one.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
          Get in touch
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight md:text-7xl">
          Let&apos;s talk.
        </h1>
        <p className="mt-4 text-xl text-[var(--color-text-secondary)]">
          Tell me what you&apos;re building. A few sentences is plenty. I read
          everything personally and reply within a couple of business days.
        </p>
      </div>

      <div className="mt-14 grid gap-10 md:grid-cols-[1fr_280px]">
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-10">
          <ContactForm />
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-brand-primary-50)] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-brand-primary-dark)]">
              Direct contact
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href="mailto:jawetzel615@gmail.com"
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <Mail size={16} /> jawetzel615@gmail.com
                </a>
              </li>
              <li>
                <a
                  href="https://www.linkedin.com/in/joshua-wetzel-97a714130"
                  className="inline-flex items-center gap-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  <LinkedinIcon size={16} /> LinkedIn
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/jawetzel"
                  className="inline-flex items-center gap-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  <GithubIcon size={16} /> github.com/jawetzel
                </a>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-sm text-[var(--color-text-secondary)]">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
              What to expect
            </p>
            <p className="mt-3">
              If it&apos;s a fit, I&apos;ll suggest a call to walk through the
              shape of the work and price it. If it isn&apos;t, I&apos;ll tell
              you fast and point you at someone who can help.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

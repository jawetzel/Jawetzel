import { Mail, Phone } from "lucide-react";
import { GithubIcon, LinkedinIcon } from "@/components/BrandIcons";
import { ContactForm } from "@/components/ContactForm";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, breadcrumbSchema, contactPageSchema } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Contact",
  description:
    "Get in touch with Joshua Wetzel — full-stack developer in Prairieville, LA (Greater Baton Rouge). First consultation is free. Inquiries go straight to my inbox; no CRM or mailing list on the other side.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([{ name: "Contact", path: "/contact" }]),
          contactPageSchema(),
        ]}
      />
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
          Get in touch · free consult
        </p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight md:text-7xl">
          Let&apos;s talk.
        </h1>
        <p className="mt-4 text-xl text-[var(--color-text-secondary)]">
          Tell me what you&apos;re building. A few sentences is plenty. The
          first call — 30 to 60 minutes, in person locally or remote — is on
          me. I read every inquiry personally and reply within a couple of
          business days.
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
                  href="mailto:josh@jawetzel.com"
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <Mail size={16} /> josh@jawetzel.com
                </a>
              </li>
              <li>
                <a
                  href="tel:+12253059321"
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <Phone size={16} /> 225-305-9321
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
              The first call is free — 30 to 60 minutes, no invoice. If it
              looks like a fit, we&apos;ll talk scope and price. If it
              doesn&apos;t, I&apos;ll say so quickly and point you at someone
              who can help.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

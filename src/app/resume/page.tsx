import Link from "next/link";
import { Download, ExternalLink, Mail, Phone, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getResume } from "@/lib/resume";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, breadcrumbSchema, profilePageSchema } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Resume",
  description:
    "Joshua Wetzel — Full Stack Software Engineer resume. .NET Core, Node, React, Next.js, Angular, SQL, MongoDB.",
  path: "/resume",
});

export default function ResumePage() {
  const r = getResume();

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-12 md:px-6 md:pt-16">
      <JsonLd
        graph={[
          breadcrumbSchema([{ name: "Resume", path: "/resume" }]),
          profilePageSchema(),
        ]}
      />
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-6 border-b border-[var(--color-border)] pb-10 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            Resume
          </p>
          <h1 className="mt-2 font-display text-5xl font-black tracking-tight md:text-6xl">
            {r.name}
          </h1>
          <p className="mt-2 text-xl text-[var(--color-text-secondary)]">
            {r.title}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <a
              href="https://images.jawetzel.com/JoshuaWetzel-20260515.pdf"
              target="_blank"
              rel="noreferrer"
            >
              <Download size={16} /> Download PDF
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Get in touch</Link>
          </Button>
        </div>
      </div>

      {/* Contact strip */}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={14} /> {r.location}
        </span>
        <a
          href={`mailto:${r.email}`}
          className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-primary-dark)]"
        >
          <Mail size={14} /> {r.email}
        </a>
        {r.phone && (
          <span className="inline-flex items-center gap-1.5">
            <Phone size={14} /> {r.phone}
          </span>
        )}
        {r.links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-primary-dark)]"
          >
            <ExternalLink size={14} /> {l.label}
          </a>
        ))}
      </div>

      {/* Summary */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold">Summary</h2>
        <div className="mt-3 space-y-4">
          {r.summary.map((para, i) => (
            <p key={i} className="text-lg text-[var(--color-text-primary)]">
              {para}
            </p>
          ))}
        </div>
      </section>

      {/* Experience */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold">Experience</h2>
        <ol className="mt-6 space-y-8">
          {r.experience.map((e, i) => (
            <li
              key={i}
              className="relative grid gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:grid-cols-[200px_1fr]"
            >
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  {e.start} – {e.end}
                </p>
                <p className="mt-1 font-display text-lg font-semibold">
                  {e.company}
                </p>
                {e.location && (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {e.location}
                  </p>
                )}
              </div>
              <div>
                <p className="font-medium">{e.role}</p>
                {e.summary && (
                  <p className="mt-3 text-[var(--color-text-primary)]">
                    {e.summary}
                  </p>
                )}
                <ul className="mt-3 space-y-2 text-[var(--color-text-primary)]">
                  {e.bullets.map((b, bi) => (
                    <li key={bi} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {e.stack && e.stack.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {e.stack.map((s) => (
                      <Badge key={s} tone="neutral">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Skills */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold">Skills</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {r.skills.map((s) => (
            <div key={s.group}>
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                {s.group}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {s.items.map((item) => (
                  <Badge key={item} tone="neutral">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Projects */}
      {r.projects && r.projects.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-2xl font-bold">Projects</h2>
          <ul className="mt-6 space-y-4">
            {r.projects.map((p) => {
              const projectLinks =
                p.links && p.links.length > 0
                  ? p.links
                  : p.url
                    ? [{ label: p.url.replace(/^https?:\/\//, ""), href: p.url }]
                    : [];
              return (
                <li
                  key={p.name}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="font-display text-lg font-semibold">
                      {p.name}
                    </p>
                    {projectLinks.length > 0 && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {projectLinks.map((l) => (
                          <a
                            key={l.href}
                            href={l.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-[var(--color-brand-primary-dark)] hover:underline"
                          >
                            {l.label} <ExternalLink size={12} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  {p.subtitle && (
                    <p className="mt-0.5 text-sm font-medium text-[var(--color-brand-primary-dark)]">
                      {p.subtitle}
                    </p>
                  )}
                  {p.description && (
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                      {p.description}
                    </p>
                  )}
                  {p.bullets && p.bullets.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-text-primary)]">
                      {p.bullets.map((b, bi) => (
                        <li key={bi} className="flex gap-2">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-brand-primary)]" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Education */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold">Education</h2>
        <ul className="mt-4 space-y-3">
          {r.education.map((ed, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-4">
              <p className="font-display text-lg font-semibold">{ed.school}</p>
              <p className="text-[var(--color-text-secondary)]">{ed.degree}</p>
              <p className="ml-auto font-mono text-sm text-[var(--color-text-muted)]">
                {ed.start} – {ed.end}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

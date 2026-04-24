import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import {
  Database,
  Download,
  DoorOpen,
  FileSearch,
  Globe,
  KeyRound,
  Layers,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { renderMarkdown } from "@/lib/markdown";
import { AuditReportViewer } from "./_components/AuditReportViewer";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, articleSchema, breadcrumbSchema } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Security Audit",
  description:
    "A zero-knowledge security audit of a mid-size B2B distributor that surfaced a severe data exposure. I reported it for free and they didn't respond. Here's the redacted report and the patterns every company should know.",
  path: "/security-audit",
});

const CONTENT_DIR = path.join(
  process.cwd(),
  "src",
  "app",
  "security-audit",
  "_content"
);

async function readSection(name: string): Promise<string> {
  const md = await fs.readFile(path.join(CONTENT_DIR, `${name}.md`), "utf8");
  const html = await renderMarkdown(md);
  return html.replace(/href="\.\/([^"]+)"/g, 'href="#$1"');
}

export default async function SecurityAuditPage() {
  const [summary, dashboards, dataLeaks, scope] = await Promise.all([
    readSection("summary"),
    readSection("details-dashboards"),
    readSection("details-data-leaks"),
    readSection("scope"),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([
            { name: "Security audit", path: "/security-audit" },
          ]),
          articleSchema({
            path: "/security-audit",
            headline:
              "A severe data exposure at a mid-size B2B distributor, reported for free and ignored.",
            description:
              "A zero-knowledge security audit of a mid-size B2B distributor that surfaced a severe data exposure. Includes a redacted report and the bug patterns to look for.",
            datePublished: "2026-04-24",
          }),
        ]}
      />
      <SectionHeader
        eyebrow="Security audit · redacted"
        title="A severe data exposure at a mid-size B2B distributor, reported for free and ignored."
        description="A zero-knowledge audit of a mid-size B2B distributor — what I found, how I disclosed it, and the patterns every company should know."
      />

      <HeroStats />

      <StorySection />

      <BugClassSection />

      <DeliverableSection
        summary={summary}
        dashboards={dashboards}
        dataLeaks={dataLeaks}
        scope={scope}
      />

      <CtaSection />
    </div>
  );
}

function HeroStats() {
  const stats: { label: string; value: string }[] = [
    { value: "14", label: "unauthenticated admin dashboards" },
    { value: "~45,000", label: "products with wholesale cost exposed" },
    { value: "~2,900", label: "customer payment records served anonymously" },
    { value: "60+", label: "employee names with phone extensions leaked" },
  ];

  return (
    <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
        >
          <div className="font-display text-3xl font-black text-[var(--color-brand-primary-dark)] md:text-4xl">
            {s.value}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)] md:text-sm">
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function StorySection() {
  return (
    <section className="mt-20 grid gap-10 md:grid-cols-[220px_1fr]">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
          The short story
        </p>
      </div>

      <div className="prose-j">
        <p>
          Early 2026 I was in talks with a mid-size B2B distributor about a
          contract. Looking over their site, something caught my eye and I
          poked at it. One issue turned into several, then into enough that
          they needed to know.
        </p>
        <p>
          I wrote it up as a full audit report and sent it over. The
          severity was high enough that they needed to know right away.
          What follows is that report, with every identifying detail
          stripped.
        </p>
      </div>
    </section>
  );
}

type BugClass = {
  title: string;
  icon: React.ReactNode;
  what: string;
  why: string;
  check: string;
};

function BugClassSection() {
  const classes: BugClass[] = [
    {
      title: "Unlocked internal dashboards",
      icon: <DoorOpen size={18} />,
      what: "Internal tools built for employees that are accidentally reachable by anyone who knows the URL.",
      why: "Every dashboard that was supposed to be internal becomes public. Customer lists, financial data, and operations data are available to anyone who finds the URL, without any actual breach.",
      check: "Ask your team which internal pages require a real login and which rely on not being linked from the homepage. Pages in the second group are the ones at risk.",
    },
    {
      title: "Guessable customer document URLs",
      icon: <KeyRound size={18} />,
      what: "Customer-specific files — statements, invoices, receipts — stored where anyone with the URL can download them.",
      why: "One exposed URL means every customer's file is exposed, because the URLs follow a predictable pattern. An attacker with a small script can collect them all overnight.",
      check: "Have a customer click \"view my statement,\" then open the URL in an incognito window with no login. If the document still loads, the issue is present.",
    },
    {
      title: "Hidden-in-the-UI data leaks",
      icon: <Database size={18} />,
      what: "The screen shows \"hidden\" or \"—\" where sensitive data should be, but the underlying data shipped to the browser still contains the real values.",
      why: "Any engineer, competitor's engineer, or curious customer with browser developer tools can see everything the UI is hiding.",
      check: "Ask an engineer to open your site as a logged-out visitor and inspect what the server sends. If the payload matches what a logged-in user sees (just visually masked) the protection is only cosmetic.",
    },
    {
      title: "Admin pages in Google results",
      icon: <Globe size={18} />,
      what: "Internal admin URLs show up in public search engines because nothing tells the crawler to skip them.",
      why: "Attackers don't have to guess where your internal tools live when the sitemap already lists them.",
      check: "Search Google for site:yourdomain.com. Any internal-looking page that appears is a potential problem.",
    },
    {
      title: "Architecture secrets in plain sight",
      icon: <FileSearch size={18} />,
      what: "Vendor names, server names, API keys, and system details embedded in what gets shipped to every visitor's browser.",
      why: "Each detail is a clue for an attacker. A vendor name points at which known vulnerabilities to try. Server names reveal topology. API keys can be used directly.",
      check: "Ask a trusted outsider to view the page source on your homepage and flag anything that looks internal, including names, hostnames, and long random strings.",
    },
    {
      title: "Missing browser-level protections",
      icon: <ShieldAlert size={18} />,
      what: "Standard protective settings that modern browsers honor when servers request them. In this case, the server is not requesting them.",
      why: "On their own these settings don't cause a breach, but they limit the damage when something else goes wrong.",
      check: "Use securityheaders.com against your URL. Anything below a B indicates that nothing is configured.",
    },
  ];

  return (
    <section className="mt-24">
      <div className="flex items-end justify-between gap-6">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            The patterns
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">
            Six ways a company accidentally hands out its own data.
          </h2>
          <p className="mt-4 text-[var(--color-text-secondary)] md:text-lg">
            Every finding in the report maps to one of these. None of them
            are exotic — they are the same mistakes that show up on almost
            every audit of a company that hasn&apos;t had one before. If any
            of these match how your team works, it&apos;s useful to know.
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {classes.map((c) => (
          <article
            key={c.title}
            className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 transition hover:border-[var(--color-brand-primary)] hover:shadow-[0_16px_32px_-20px_rgba(23,69,67,0.3)]"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
                {c.icon}
              </span>
              <h3 className="font-display text-lg font-semibold tracking-tight md:text-xl">
                {c.title}
              </h3>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <Row label="What" body={c.what} />
              <Row label="Why it matters" body={c.why} />
              <Row label="How to spot it" body={c.check} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function Row({ label, body }: { label: string; body: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="text-[var(--color-text-secondary)]">{body}</dd>
    </div>
  );
}

function DeliverableSection({
  summary,
  dashboards,
  dataLeaks,
  scope,
}: {
  summary: string;
  dashboards: string;
  dataLeaks: string;
  scope: string;
}) {
  return (
    <section className="mt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            The deliverable
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">
            The redacted report.
          </h2>
          <p className="mt-4 text-[var(--color-text-secondary)] md:text-lg">
            This is the deliverable I sent, sanitized so nothing identifies
            the company or points at the portion of the issue that
            isn&apos;t fully patched yet. The full version ran about 30
            pages.
          </p>
        </div>

        <a
          href="/security-audit/Security_Audit_Report_Redacted.pdf"
          download
          className="inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-primary-deep)] px-5 py-3 text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-brand-primary-dark)]"
        >
          <Download size={16} /> Download PDF
        </a>
      </div>

      <AuditReportViewer
        summary={summary}
        dashboards={dashboards}
        dataLeaks={dataLeaks}
        scope={scope}
      />
    </section>
  );
}

function CtaSection() {
  return (
    <section className="mt-24 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-brand-primary-50)] p-8 md:p-12">
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--color-brand-primary-dark)]" />
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
              No pitch
            </p>
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold tracking-tight md:text-3xl">
            Do any of these patterns sound familiar in your stack?
          </h2>
          <p className="mt-3 text-[var(--color-text-secondary)] md:text-lg">
            I&apos;m happy to talk through what to look for or how to triage
            something you already found. No invoice and no sales pitch
            attached.
          </p>
        </div>
        <Link
          href="/contact"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-brand-primary-deep)] bg-[var(--color-brand-primary-deep)] px-6 py-3 text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-brand-primary-dark)]"
        >
          <Layers size={16} /> Contact me
        </Link>
      </div>
    </section>
  );
}

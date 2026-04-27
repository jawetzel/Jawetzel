"use client";

import { useEffect, useState } from "react";
import { FileText, LayoutDashboard, Database, Shield } from "lucide-react";

type SectionId = "summary" | "details-dashboards" | "details-data-leaks" | "scope";

type Section = {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  html: string;
  extra?: React.ReactNode;
};

type SeverityRow = { priority: "High" | "Medium" | "Low"; count: number; examples: string };

const SEVERITY_ROWS: SeverityRow[] = [
  {
    priority: "High",
    count: 4,
    examples:
      "Unauthenticated internal dashboards · customer documents on public storage · product & pricing data leaked in-page · internal paths indexed by search engines",
  },
  {
    priority: "Medium",
    count: 3,
    examples:
      "Employee PII + live call availability · warehouse layout with regulated-inventory locations · live call metrics auto-refreshing",
  },
];

function SeveritySummary() {
  return (
    <div className="my-6">
      <h2 className="font-display text-[1.75rem] font-bold tracking-tight">Severity summary</h2>

      <div className="mt-4 hidden overflow-hidden rounded-[10px] border border-[var(--color-border)] sm:block">
        <table className="w-full border-collapse text-[0.95rem]">
          <thead className="bg-[var(--color-brand-primary-deep)]">
            <tr>
              <th className="px-3 py-2 text-left text-[0.85rem] font-semibold tracking-wide text-[var(--color-text-inverse)]">
                Priority
              </th>
              <th className="px-3 py-2 text-left text-[0.85rem] font-semibold tracking-wide text-[var(--color-text-inverse)]">
                Count
              </th>
              <th className="px-3 py-2 text-left text-[0.85rem] font-semibold tracking-wide text-[var(--color-text-inverse)]">
                Examples
              </th>
            </tr>
          </thead>
          <tbody>
            {SEVERITY_ROWS.map((r, i) => (
              <tr
                key={r.priority}
                className={i % 2 === 1 ? "bg-[var(--color-surface-muted)]" : ""}
              >
                <td className="border-t border-[var(--color-border)] px-3 py-3 align-top font-medium">
                  {r.priority}
                </td>
                <td className="border-t border-[var(--color-border)] px-3 py-3 align-top">
                  {r.count}
                </td>
                <td className="border-t border-[var(--color-border)] px-3 py-3 align-top">
                  {r.examples}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-3 sm:hidden">
        {SEVERITY_ROWS.map((r) => (
          <li
            key={r.priority}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold tracking-tight">
                {r.priority}
              </span>
              <span className="rounded-full bg-[var(--color-brand-primary-100)] px-2.5 py-0.5 font-mono text-xs text-[var(--color-brand-primary-deep)]">
                {r.count} findings
              </span>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              {r.examples}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-[var(--color-text-secondary)]">
        See{" "}
        <a
          href="#details-dashboards"
          className="text-[var(--color-brand-primary-dark)] underline underline-offset-[3px] hover:text-[var(--color-brand-primary-deep)]"
        >
          Internal pages exposed
        </a>{" "}
        and{" "}
        <a
          href="#details-data-leaks"
          className="text-[var(--color-brand-primary-dark)] underline underline-offset-[3px] hover:text-[var(--color-brand-primary-deep)]"
        >
          Data leaks
        </a>{" "}
        for the drill-down.{" "}
        <a
          href="#scope"
          className="text-[var(--color-brand-primary-dark)] underline underline-offset-[3px] hover:text-[var(--color-brand-primary-deep)]"
        >
          Scope
        </a>{" "}
        covers what was and was not examined.
      </p>
    </div>
  );
}

export function AuditReportViewer({
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
  const sections: Section[] = [
    { id: "summary", label: "Summary", icon: <FileText size={16} />, html: summary, extra: <SeveritySummary /> },
    { id: "details-dashboards", label: "Internal pages exposed", icon: <LayoutDashboard size={16} />, html: dashboards },
    { id: "details-data-leaks", label: "Data leaks", icon: <Database size={16} />, html: dataLeaks },
    { id: "scope", label: "What we looked at", icon: <Shield size={16} />, html: scope },
  ];

  const [active, setActive] = useState<SectionId>("summary");

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.replace("#", "");
      if (sections.some((s) => s.id === hash)) setActive(hash as SectionId);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = sections.find((s) => s.id === active) ?? sections[0];

  return (
    <div className="mt-8 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
      <div className="grid md:grid-cols-[220px_1fr]">
        <nav className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 md:border-b-0 md:border-r">
          <p className="mb-2 px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
            Redacted report
          </p>
          <ul className="grid grid-cols-2 gap-1 md:flex md:flex-col">
            {sections.map((s) => {
              const isActive = s.id === active;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActive(s.id);
                      if (typeof window !== "undefined") {
                        history.replaceState(null, "", `#${s.id}`);
                      }
                    }}
                    className={`flex h-full w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                      isActive
                        ? "bg-[var(--color-brand-primary)] text-[var(--color-brand-primary-deep)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <span className="shrink-0">{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <article className="min-w-0 p-6 md:p-10">
          <div
            className="prose-j"
            dangerouslySetInnerHTML={{ __html: current.html }}
          />
          {current.extra}
        </article>
      </div>
    </div>
  );
}

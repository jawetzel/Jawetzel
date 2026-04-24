"use client";

import { useEffect, useState } from "react";
import { FileText, LayoutDashboard, Database, Shield } from "lucide-react";

type SectionId = "summary" | "details-dashboards" | "details-data-leaks" | "scope";

type Section = {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  html: string;
};

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
    { id: "summary", label: "Summary", icon: <FileText size={16} />, html: summary },
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
          <ul className="flex flex-row gap-1 overflow-x-auto md:flex-col">
            {sections.map((s) => {
              const isActive = s.id === active;
              return (
                <li key={s.id} className="shrink-0 md:shrink">
                  <button
                    type="button"
                    onClick={() => {
                      setActive(s.id);
                      if (typeof window !== "undefined") {
                        history.replaceState(null, "", `#${s.id}`);
                      }
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                      isActive
                        ? "bg-[var(--color-brand-primary)] text-[var(--color-brand-primary-deep)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <span className="shrink-0">{s.icon}</span>
                    <span className="whitespace-nowrap md:whitespace-normal">
                      {s.label}
                    </span>
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
        </article>
      </div>
    </div>
  );
}

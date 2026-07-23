"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import type {
  BookConsultResult,
  FindThreadColorResult,
  ProjectHit,
  SearchProjectsResult,
  ThreadMatchTile,
  ToolResultPayload,
} from "./types";

interface ResumeContactData {
  name: string;
  title: string;
  location: string;
  email: string;
  phone?: string;
  links: { label: string; href: string }[];
}

export function ToolResultRenderer({
  payload,
  onNavigate,
}: {
  payload: ToolResultPayload;
  onNavigate?: () => void;
}) {
  switch (payload.tool) {
    case "find_thread_color":
      return (
        <ThreadColorTiles
          data={payload.data as FindThreadColorResult}
          onNavigate={onNavigate}
        />
      );
    case "search_projects":
      return (
        <ProjectCards
          data={payload.data as SearchProjectsResult}
          onNavigate={onNavigate}
        />
      );
    case "get_resume":
      return (
        <ResumeSnippet
          data={payload.data as { section: string; data: unknown }}
        />
      );
    case "book_consult":
      return <ConsultCard data={payload.data as BookConsultResult} />;
    default:
      return null;
  }
}

/* ── book_consult ─────────────────────────────────────────────────────── */

function ConsultCard({ data }: { data: BookConsultResult }) {
  return (
    <div className="mt-2 w-full max-w-[300px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
          <CalendarDays size={16} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">
            Free 30-minute consult
          </div>
          {data.topic && (
            <div className="truncate text-[11px] text-[var(--color-text-muted)]">
              {data.topic}
            </div>
          )}
        </div>
      </div>
      <a
        href={data.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-full bg-[var(--color-brand-primary-deep)] px-4 py-2 text-xs font-semibold text-[var(--color-text-inverse)] transition hover:bg-[var(--color-brand-primary-dark)]"
      >
        Pick a time <ArrowUpRight size={13} />
      </a>
      <div className="mt-2 text-center text-[10px] text-[var(--color-text-muted)]">
        Prefer email?{" "}
        <a
          href={`mailto:${data.email}`}
          className="underline hover:text-[var(--color-text-primary)]"
        >
          {data.email}
        </a>
      </div>
    </div>
  );
}

/* ── find_thread_color ────────────────────────────────────────────────── */

function ThreadColorTiles({
  data,
  onNavigate,
}: {
  data: FindThreadColorResult;
  onNavigate?: () => void;
}) {
  if (!data.matches.length) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {data.matches.map((m) => (
        <ThreadTile key={`${m.brand}-${m.color_number}`} tile={m} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function ThreadTile({
  tile,
  onNavigate,
}: {
  tile: ThreadMatchTile;
  onNavigate?: () => void;
}) {
  // Build the link at render time from the hex only — no tolerance param,
  // so the page's current default governs what the table shows. This also
  // sidesteps old stored deep_links from when tolerance was baked in.
  const hexNoHash = tile.hex.replace(/^#/, "");
  const href = `/tools/embroidery-supplies?hex=${hexNoHash}#thread-lookup`;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="group flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition-shadow hover:shadow-md"
    >
      <div
        className="h-16 w-full"
        style={{ backgroundColor: tile.hex }}
        aria-label={tile.color_name ?? tile.hex}
      />
      <div className="flex-1 px-2 py-1.5 text-[11px] leading-tight">
        <div className="truncate font-semibold text-[var(--color-text-primary)]">
          {tile.color_name ?? tile.color_number}
        </div>
        <div className="truncate text-[var(--color-text-muted)]">
          {tile.brand} · {tile.color_number}
        </div>
        {tile.cheapest_price !== null && (
          <div className="mt-0.5 text-[var(--color-text-secondary)]">
            ${tile.cheapest_price.toFixed(2)}
            {tile.length_yds ? ` · ${tile.length_yds}yd` : ""}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ── search_projects ──────────────────────────────────────────────────── */

function ProjectCards({
  data,
  onNavigate,
}: {
  data: SearchProjectsResult;
  onNavigate?: () => void;
}) {
  if (!data.projects.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {data.projects.map((p) => (
        <ProjectCard key={p.slug} project={p} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function ProjectCard({
  project,
  onNavigate,
}: {
  project: ProjectHit;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={project.url}
      onClick={onNavigate}
      className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {project.name}
        </h4>
        {project.status && (
          <span className="flex-none rounded-full bg-[var(--color-brand-primary-100)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-brand-primary-deep)]">
            {project.status}
          </span>
        )}
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-secondary)]">
        {project.tagline}
      </p>
      {project.stack.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {project.stack.slice(0, 5).map((s) => (
            <span
              key={s}
              className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

/* ── get_resume ───────────────────────────────────────────────────────── */

function ResumeSnippet({
  data,
}: {
  data: { section: string; data: unknown };
}) {
  if (data.section !== "contact") return null;
  const contact = data.data as ResumeContactData;
  return (
    <div className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-xs">
      <div className="font-semibold text-[var(--color-text-primary)]">
        {contact.name}
      </div>
      <div className="text-[var(--color-text-muted)]">{contact.title}</div>
      <div className="mt-1 flex flex-col gap-0.5 text-[var(--color-text-secondary)]">
        <a href={`mailto:${contact.email}`} className="hover:underline">
          {contact.email}
        </a>
        {contact.phone && <span>{contact.phone}</span>}
        {contact.links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

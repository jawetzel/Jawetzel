/**
 * Tool: search portfolio projects by keyword. Returns enough context for
 * the assistant to summarize + link back to each case study.
 */

import { getAllProjects } from "@/lib/projects";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const BRIEF_CHARS = 240;

export const searchProjectsTool = {
  type: "function" as const,
  function: {
    name: "search_projects",
    description:
      "Search Joshua's portfolio projects by keyword. Use when the user asks what he's built, wants to see something in a specific stack, or references a project. Return value includes a URL back to the full case study.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Free-text keyword matched against name, tagline, stack, problem, outcome, and highlights. Omit to list every project.",
        },
        featured_only: {
          type: "boolean",
          description: "Only return featured projects.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5, max 10).",
        },
      },
    },
  },
};

export interface SearchProjectsArgs {
  q?: string;
  featured_only?: boolean;
  limit?: number;
}

export interface ProjectHit {
  slug: string;
  name: string;
  tagline: string;
  stack: string[];
  status: string | null;
  featured: boolean;
  external_url: string | null;
  url: string;
  brief: string;
}

export interface SearchProjectsResult {
  query: string | null;
  total: number;
  projects: ProjectHit[];
}

function scoreField(text: string, q: string, weight: number): number {
  if (!q) return 0;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let hits = 0;
  let i = 0;
  while ((i = lower.indexOf(needle, i)) !== -1) {
    hits++;
    i += needle.length;
  }
  return hits * weight;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const last = cut.lastIndexOf(" ");
  return (last > n * 0.5 ? cut.slice(0, last) : cut) + "…";
}

export async function executeSearchProjects(
  args: SearchProjectsArgs,
): Promise<SearchProjectsResult> {
  const projects = getAllProjects();
  const q = (args.q ?? "").trim();
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));

  let filtered = projects;
  if (args.featured_only) filtered = filtered.filter((p) => p.featured);

  const ranked = filtered
    .map((p) => {
      const nameS = scoreField(p.name, q, 4);
      const taglineS = scoreField(p.tagline, q, 3);
      const stackS = q
        ? p.stack.some((t) => t.toLowerCase().includes(q.toLowerCase())) ? 3 : 0
        : 0;
      const problemS = scoreField(p.problem, q, 1);
      const outcomeS = scoreField(p.outcome, q, 1);
      const highlightsS = q
        ? (p.highlights ?? []).reduce(
            (acc, h) => acc + scoreField(h, q, 1),
            0,
          )
        : 0;
      return {
        p,
        s:
          nameS + taglineS + stackS + problemS + outcomeS + highlightsS,
      };
    })
    .filter((r) => (q ? r.s > 0 : true))
    .sort((a, b) => {
      if (a.s !== b.s) return b.s - a.s;
      // Ties: featured first, then order field (lower first).
      if (a.p.featured !== b.p.featured) return a.p.featured ? -1 : 1;
      return (a.p.order ?? 99) - (b.p.order ?? 99);
    });

  return {
    query: q || null,
    total: ranked.length,
    projects: ranked.slice(0, limit).map(({ p }) => ({
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      stack: p.stack,
      status: p.status ?? null,
      featured: Boolean(p.featured),
      external_url: p.url ?? null,
      url: `/projects/${p.slug}`,
      brief: truncate(p.problem, BRIEF_CHARS),
    })),
  };
}

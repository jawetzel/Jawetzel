import { type ProjectCaseStudy } from "@/domain/content/project";
import { type GetAllProjects } from "@/application/use-cases/content/get-all-projects";

/**
 * SearchProjects — the `search_projects` chat tool's ranking/shaping logic,
 * lifted out of `src/lib/ai/tools/search-projects.ts` so the scoring,
 * tie-breaks, limit clamp, and DTO mapping are pure and unit-testable without
 * any I/O. The use-case composes the existing `GetAllProjects` content read
 * (the only data it needs) — keeping the project read's sort/cap rules in one
 * place — then applies the keyword ranking that is specific to the AI tool.
 *
 * Behavior is preserved byte-for-byte from the flat tool: identical field
 * weights (name×4, tagline×3, stack ±3, problem×1, outcome×1, highlight×1),
 * the q-empty "keep all" path, the `featured_only` filter, the score-desc →
 * featured-first → `order ?? 99` tie-break, the `min(10, max(1, limit ?? 5))`
 * clamp, and the `ProjectHit` mapping (including `truncate`).
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const BRIEF_CHARS = 240;

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

/** Count case-insensitive occurrences of `q` in `text`, multiplied by `weight`. */
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

/**
 * Trim `s` to at most `n` chars with an ellipsis. If the last space falls past
 * the halfway mark, cut on the word boundary; otherwise hard-cut. Lifted
 * verbatim from the flat tool.
 */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const last = cut.lastIndexOf(" ");
  return (last > n * 0.5 ? cut.slice(0, last) : cut) + "…";
}

/**
 * rankProjects — the pure ranking + shaping of the project search. Given the
 * full (already content-ordered) project list and the parsed args, score, sort,
 * clamp, and map to `ProjectHit`s. No I/O — unit-tested directly.
 */
export function rankProjects(
  projects: ProjectCaseStudy[],
  args: SearchProjectsArgs,
): SearchProjectsResult {
  const q = (args.q ?? "").trim();
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));

  let filtered = projects;
  if (args.featured_only) filtered = filtered.filter((p) => p.featured);

  const ranked = filtered
    .map((p) => {
      const nameS = scoreField(p.name, q, 4);
      const taglineS = scoreField(p.tagline, q, 3);
      const stackS = q
        ? p.stack.some((t) => t.toLowerCase().includes(q.toLowerCase()))
          ? 3
          : 0
        : 0;
      const problemS = scoreField(p.problem, q, 1);
      const outcomeS = scoreField(p.outcome, q, 1);
      const highlightsS = q
        ? (p.highlights ?? []).reduce((acc, h) => acc + scoreField(h, q, 1), 0)
        : 0;
      return {
        p,
        s: nameS + taglineS + stackS + problemS + outcomeS + highlightsS,
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

export interface SearchProjectsDeps {
  getAllProjects: GetAllProjects;
}

export interface SearchProjects {
  execute(args: SearchProjectsArgs): Promise<SearchProjectsResult>;
}

export function createSearchProjects(deps: SearchProjectsDeps): SearchProjects {
  const { getAllProjects } = deps;

  return {
    async execute(args) {
      const projects = await getAllProjects.execute();
      return rankProjects(projects, args);
    },
  };
}

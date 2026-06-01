import { type ContentSource } from "@/application/ports/content-source";
import { type ProjectCaseStudy } from "@/domain/content/project";
import {
  PROJECTS_DIR,
  sortProjects,
} from "@/application/use-cases/content/get-all-projects";

/**
 * The home page shows the most important works only — a hard cap of four
 * (`CLAUDE.md` → "Project/work sync"). The cap is an application rule, enforced
 * here so it's unit-testable rather than implicit in the content data: even if
 * a future content edit leaves five `featured: true`, the home strip still
 * renders exactly four, in `order` ascending.
 */
export const FEATURED_CAP = 4;

/**
 * GetFeaturedProjects — the ordered, capped set of featured projects for the
 * home page (and the chat tool's `featured_only` path builds on the same
 * filter). Filter `featured` → sort by `order` → take the first `FEATURED_CAP`.
 */
export interface GetFeaturedProjectsDeps {
  content: ContentSource;
}

export interface GetFeaturedProjects {
  execute(): Promise<ProjectCaseStudy[]>;
}

export function createGetFeaturedProjects(
  deps: GetFeaturedProjectsDeps,
): GetFeaturedProjects {
  const { content } = deps;

  return {
    async execute() {
      const projects =
        await content.readJsonCollection<ProjectCaseStudy>(PROJECTS_DIR);
      return sortProjects(projects.filter((p) => p.featured)).slice(
        0,
        FEATURED_CAP,
      );
    },
  };
}

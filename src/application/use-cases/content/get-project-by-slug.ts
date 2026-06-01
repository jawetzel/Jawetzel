import { type ContentSource } from "@/application/ports/content-source";
import { type ProjectCaseStudy } from "@/domain/content/project";
import {
  PROJECTS_DIR,
  sortProjects,
} from "@/application/use-cases/content/get-all-projects";

/**
 * GetProjectBySlug — resolve a single project case study by slug, or `null` if
 * none matches (the detail page renders `notFound()` on `null`). Reads the
 * collection and finds by slug, matching the old getter's
 * `getAllProjects().find(...)` behavior; ordering is applied so any
 * order-dependent lookup stays consistent with the list.
 */
export interface GetProjectBySlugDeps {
  content: ContentSource;
}

export interface GetProjectBySlug {
  execute(slug: string): Promise<ProjectCaseStudy | null>;
}

export function createGetProjectBySlug(
  deps: GetProjectBySlugDeps,
): GetProjectBySlug {
  const { content } = deps;

  return {
    async execute(slug: string) {
      const projects =
        await content.readJsonCollection<ProjectCaseStudy>(PROJECTS_DIR);
      return sortProjects(projects).find((p) => p.slug === slug) ?? null;
    },
  };
}

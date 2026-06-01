import { type ContentSource } from "@/application/ports/content-source";
import { type ProjectCaseStudy } from "@/domain/content/project";

/** Content-root-relative directory holding one JSON file per project. */
export const PROJECTS_DIR = "projects";

/**
 * Order projects by the `order` field ascending; entries without an `order`
 * sort last (`?? 99`). This is the canonical project ordering shared by every
 * project read — `GetFeaturedProjects` and `GetProjectBySlug` build on it — so
 * the list/detail pages, the home strip, the sitemap, and the chat tool all
 * agree. Lifted verbatim from the old `getAllProjects()` getter.
 */
export function sortProjects(projects: ProjectCaseStudy[]): ProjectCaseStudy[] {
  return [...projects].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/**
 * GetAllProjects — read every project case study, ordered by `order` ascending.
 * The filesystem read is the `ContentSource` adapter; the ordering is the
 * application rule that lives here (and is therefore unit-testable against a
 * fake source).
 */
export interface GetAllProjectsDeps {
  content: ContentSource;
}

export interface GetAllProjects {
  execute(): Promise<ProjectCaseStudy[]>;
}

export function createGetAllProjects(
  deps: GetAllProjectsDeps,
): GetAllProjects {
  const { content } = deps;

  return {
    async execute() {
      const projects =
        await content.readJsonCollection<ProjectCaseStudy>(PROJECTS_DIR);
      return sortProjects(projects);
    },
  };
}

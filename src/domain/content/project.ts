/**
 * ProjectCaseStudy — the shape of a file-sourced project case study
 * (`src/content/projects/<slug>.json`). A pure content type with zero I/O; the
 * directory read lives behind `ContentSource.readJsonCollection` and the
 * sort/`featured`/cap-of-4 shaping is orchestrated by the project use-cases
 * (`GetAllProjects`, `GetFeaturedProjects`, `GetProjectBySlug`).
 */
export interface ProjectCaseStudy {
  slug: string;
  name: string;
  tagline: string;
  url?: string;
  logo?: string;
  hero?: string;
  stack: string[];
  highlights?: string[];
  featured?: boolean;
  order?: number;
  status?: "live" | "beta" | "archived";
  problem: string;
  actions: { title: string; body: string }[];
  outcome: string;
  underTheHood: string;
  links?: { label: string; href: string }[];
  screenshots?: { src: string; alt: string }[];
}

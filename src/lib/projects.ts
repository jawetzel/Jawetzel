import fs from "node:fs";
import path from "node:path";

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

const PROJECTS_DIR = path.join(process.cwd(), "src", "content", "projects");

export function getAllProjects(): ProjectCaseStudy[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json"));
  const items: ProjectCaseStudy[] = files.map((f) => {
    const raw = fs.readFileSync(path.join(PROJECTS_DIR, f), "utf8");
    return JSON.parse(raw) as ProjectCaseStudy;
  });
  items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return items;
}

export function getProjectBySlug(slug: string): ProjectCaseStudy | null {
  return getAllProjects().find((p) => p.slug === slug) ?? null;
}

export function getFeaturedProjects(): ProjectCaseStudy[] {
  return getAllProjects().filter((p) => p.featured);
}

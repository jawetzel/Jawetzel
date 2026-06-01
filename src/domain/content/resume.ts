/**
 * ResumeData — the shape of the file-sourced resume (`src/content/resume.json`).
 * A pure content type with zero I/O; the read lives behind `ContentSource` and
 * is orchestrated by the `GetResume` use-case.
 */
export interface ResumeData {
  name: string;
  title: string;
  location: string;
  email: string;
  phone?: string;
  links: { label: string; href: string }[];
  summary: string[];
  experience: {
    company: string;
    role: string;
    location?: string;
    start: string;
    end: string;
    summary?: string;
    bullets: string[];
    stack?: string[];
  }[];
  education: {
    school: string;
    degree: string;
    start: string;
    end: string;
  }[];
  skills: { group: string; items: string[] }[];
  projects?: {
    name: string;
    url?: string;
    links?: { label: string; href: string }[];
    subtitle?: string;
    description?: string;
    bullets?: string[];
  }[];
}

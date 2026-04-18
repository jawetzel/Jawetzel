import fs from "node:fs";
import path from "node:path";

export interface ResumeData {
  name: string;
  title: string;
  location: string;
  email: string;
  phone?: string;
  links: { label: string; href: string }[];
  summary: string;
  experience: {
    company: string;
    role: string;
    location?: string;
    start: string;
    end: string;
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
  projects?: { name: string; url?: string; note: string }[];
}

const FILE = path.join(process.cwd(), "src", "content", "resume.json");

let cache: ResumeData | null = null;

export function getResume(): ResumeData {
  if (cache) return cache;
  const raw = fs.readFileSync(FILE, "utf8");
  cache = JSON.parse(raw) as ResumeData;
  return cache;
}

import fs from "node:fs";
import path from "node:path";

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company?: string;
  avatarUrl?: string;
}

const FILE = path.join(process.cwd(), "src", "content", "testimonials.json");

let cache: Testimonial[] | null = null;

export function getTestimonials(): Testimonial[] {
  if (cache) return cache;
  if (!fs.existsSync(FILE)) {
    cache = [];
    return cache;
  }
  const raw = fs.readFileSync(FILE, "utf8");
  cache = JSON.parse(raw) as Testimonial[];
  return cache;
}

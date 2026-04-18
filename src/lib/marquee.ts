import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "src", "content", "marquee.json");

let cache: string[] | null = null;

export function getMarqueeItems(): string[] {
  if (cache) return cache;
  if (!fs.existsSync(FILE)) {
    cache = [];
    return cache;
  }
  const raw = fs.readFileSync(FILE, "utf8");
  cache = JSON.parse(raw) as string[];
  return cache;
}

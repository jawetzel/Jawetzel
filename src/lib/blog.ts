import fs from "node:fs";
import path from "node:path";

export type PostKind = "article" | "video" | "both";

export interface BlogPost {
  slug: string;
  date: string;
  title: string;
  description: string;
  tags: string[];
  kind: PostKind;
  bodyMd: string;
  hero?: string;
  youtubeId?: string;
  videoMeta?: { duration?: string; publishedAtOnYt?: string };
}

const BLOG_DIR = path.join(process.cwd(), "blog");

let cache: BlogPost[] | null = null;

function parseFile(fileName: string): BlogPost | null {
  if (!fileName.endsWith(".json")) return null;
  const base = fileName.replace(/\.json$/, "");
  const m = base.match(/^(\d{4}-\d{2}-\d{2})(?:-(.+))?$/);
  if (!m) return null;
  const [, date] = m;
  const raw = fs.readFileSync(path.join(BLOG_DIR, fileName), "utf8");
  const json = JSON.parse(raw) as Partial<BlogPost>;
  const slug = json.slug ?? base;
  return {
    slug,
    date: json.date ?? date,
    title: json.title ?? "(untitled)",
    description: json.description ?? "",
    tags: json.tags ?? [],
    kind: json.kind ?? "article",
    bodyMd: json.bodyMd ?? "",
    hero: json.hero,
    youtubeId: json.youtubeId,
    videoMeta: json.videoMeta,
  };
}

export function getAllPosts(): BlogPost[] {
  if (cache) return cache;
  if (!fs.existsSync(BLOG_DIR)) {
    cache = [];
    return cache;
  }
  const files = fs.readdirSync(BLOG_DIR);
  const posts: BlogPost[] = [];
  for (const f of files) {
    if (f.startsWith("_") || f.startsWith(".")) continue;
    const post = parseFile(f);
    if (post) posts.push(post);
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  cache = posts;
  return cache;
}

export function getPostBySlug(slug: string): BlogPost | null {
  return getAllPosts().find((p) => p.slug === slug) ?? null;
}

export function getAllTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of getAllPosts()) {
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPostsByKind(kind: PostKind | "all"): BlogPost[] {
  const all = getAllPosts();
  if (kind === "all") return all;
  return all.filter((p) => p.kind === kind || p.kind === "both");
}

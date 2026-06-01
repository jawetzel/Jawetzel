import { type BlogPost } from "@/domain/content/blog-post";
import { type GetAllPosts } from "@/application/use-cases/content/get-all-posts";

/**
 * SearchBlog — the `search_blog` chat tool's ranking/shaping logic, lifted out
 * of `src/lib/ai/tools/search-blog.ts` so the scoring, tie-break, tag filter,
 * limit clamp, and DTO mapping are pure and unit-testable without any I/O. The
 * use-case composes the existing `GetAllPosts` content read (the only data it
 * needs) — keeping the newest-first/parse rules in one place — then applies the
 * keyword ranking specific to the AI tool.
 *
 * Behavior is preserved byte-for-byte from the flat tool: identical field
 * weights (title×3, description×2, tag ±2, body×1), the exact tag filter
 * (`tags.includes(tag)`), the q-empty "keep all" path, the score-desc →
 * `date.localeCompare` descending tie-break, the `min(10, max(1, limit ?? 5))`
 * clamp, and the `BlogHit` mapping.
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export interface SearchBlogArgs {
  q?: string;
  tag?: string;
  limit?: number;
}

export interface BlogHit {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  kind: string;
  url: string;
}

export interface SearchBlogResult {
  query: string | null;
  tag: string | null;
  total: number;
  posts: BlogHit[];
}

/** Count case-insensitive occurrences of `q` in `text` (0 when `q` is empty). */
function score(text: string, q: string): number {
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!needle) return 0;
  let hits = 0;
  let i = 0;
  while ((i = lower.indexOf(needle, i)) !== -1) {
    hits++;
    i += needle.length;
  }
  return hits;
}

/**
 * rankPosts — the pure ranking + shaping of the blog search. Given the full
 * (already newest-first) post list and the parsed args, apply the tag filter,
 * score, sort, clamp, and map to `BlogHit`s. No I/O — unit-tested directly.
 */
export function rankPosts(
  posts: BlogPost[],
  args: SearchBlogArgs,
): SearchBlogResult {
  const q = (args.q ?? "").trim();
  const tag = (args.tag ?? "").trim();
  const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));

  let filtered = posts;
  if (tag) filtered = filtered.filter((p) => p.tags.includes(tag));

  const ranked = filtered
    .map((p) => {
      const titleScore = q ? score(p.title, q) * 3 : 0;
      const descScore = q ? score(p.description, q) * 2 : 0;
      const tagScore = q
        ? p.tags.some((t) => t.toLowerCase().includes(q.toLowerCase()))
          ? 2
          : 0
        : 0;
      const bodyScore = q ? score(p.bodyMd, q) : 0;
      return {
        post: p,
        s: titleScore + descScore + tagScore + bodyScore,
      };
    })
    .filter((r) => (q ? r.s > 0 : true))
    .sort((a, b) => {
      if (a.s !== b.s) return b.s - a.s;
      return b.post.date.localeCompare(a.post.date);
    });

  return {
    query: q || null,
    tag: tag || null,
    total: ranked.length,
    posts: ranked.slice(0, limit).map(({ post }) => ({
      slug: post.slug,
      title: post.title,
      description: post.description,
      date: post.date,
      tags: post.tags,
      kind: post.kind,
      url: `/blog/${post.slug}`,
    })),
  };
}

export interface SearchBlogDeps {
  getAllPosts: GetAllPosts;
}

export interface SearchBlog {
  execute(args: SearchBlogArgs): Promise<SearchBlogResult>;
}

export function createSearchBlog(deps: SearchBlogDeps): SearchBlog {
  const { getAllPosts } = deps;

  return {
    async execute(args) {
      const posts = await getAllPosts.execute();
      return rankPosts(posts, args);
    },
  };
}

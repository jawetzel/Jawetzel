/**
 * Tool: search blog posts by keyword or tag. Returns a ranked list the
 * assistant can summarize and link back to.
 */

import { getAllPosts } from "@/lib/blog";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export const searchBlogTool = {
  type: "function" as const,
  function: {
    name: "search_blog",
    description:
      "Search Joshua's blog posts by keyword or tag. Use when the user asks what he's written about, wants to read about a topic, or references a post he might have published.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Free-text keyword matched against title, description, tags, and body.",
        },
        tag: {
          type: "string",
          description: "Exact tag filter. Combines with q when both supplied.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5, max 10).",
        },
      },
    },
  },
};

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

export async function executeSearchBlog(
  args: SearchBlogArgs,
): Promise<SearchBlogResult> {
  const posts = getAllPosts();
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
        ? p.tags.some((t) => t.toLowerCase().includes(q.toLowerCase())) ? 2 : 0
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

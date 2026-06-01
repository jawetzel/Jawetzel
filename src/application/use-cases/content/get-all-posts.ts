import { type ContentSource } from "@/application/ports/content-source";
import { type BlogPost, parseBlogPost } from "@/domain/content/blog-post";

/**
 * Directory holding one JSON file per blog post. Unlike the projects directory,
 * this lives at the **repo root** (`blog/`), not under `src/content/` — hence
 * the `"repo-root"` base passed to the content source.
 */
export const BLOG_DIR = "blog";

/**
 * Order posts newest-first by `date` (descending). Lifted verbatim from the old
 * `getAllPosts()` getter's comparator, which compared the ISO `date` strings
 * directly. This is the canonical blog ordering every blog read builds on —
 * `GetPostBySlug` (older/newer neighbors), `GetAllTags`, `GetPostsByKind` — so
 * the index, the detail prev/next, the RSS feed, and the sitemap all agree.
 */
export function sortPostsNewestFirst(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}

/**
 * GetAllPosts — read every blog post, newest-first.
 *
 * The repo-root directory read is the `ContentSource` adapter; the
 * filename-derived defaulting (`parseBlogPost`) and the newest-first ordering
 * are the rules that live here (and are therefore unit-testable against a fake
 * source). Files whose name starts with `_` or `.` are skipped, and
 * `parseBlogPost` returns `null` for non-`.json` / non-date-prefixed names —
 * both filters preserved from the old getter.
 */
export interface GetAllPostsDeps {
  content: ContentSource;
}

export interface GetAllPosts {
  execute(): Promise<BlogPost[]>;
}

export function createGetAllPosts(deps: GetAllPostsDeps): GetAllPosts {
  const { content } = deps;

  return {
    async execute() {
      const entries = await content.readJsonCollectionWithNames<
        Partial<BlogPost>
      >(BLOG_DIR, "repo-root");

      const posts: BlogPost[] = [];
      for (const { name, data } of entries) {
        if (name.startsWith("_") || name.startsWith(".")) continue;
        const post = parseBlogPost(name, data);
        if (post) posts.push(post);
      }
      return sortPostsNewestFirst(posts);
    },
  };
}

import { type ContentSource } from "@/application/ports/content-source";
import { type BlogPost } from "@/domain/content/blog-post";
import {
  createGetAllPosts,
  type GetAllPosts,
} from "@/application/use-cases/content/get-all-posts";

/**
 * GetPostBySlug — resolve a single blog post by slug, or `null` if none matches
 * (the detail page renders `notFound()` on `null`). Reads the newest-first
 * collection and finds by slug, matching the old getter's
 * `getAllPosts().find(...)` behavior.
 */
export interface GetPostBySlugDeps {
  content: ContentSource;
}

export interface GetPostBySlug {
  execute(slug: string): Promise<BlogPost | null>;
}

export function createGetPostBySlug(deps: GetPostBySlugDeps): GetPostBySlug {
  const { content } = deps;
  const getAllPosts: GetAllPosts = createGetAllPosts({ content });

  return {
    async execute(slug: string) {
      const posts = await getAllPosts.execute();
      return posts.find((p) => p.slug === slug) ?? null;
    },
  };
}

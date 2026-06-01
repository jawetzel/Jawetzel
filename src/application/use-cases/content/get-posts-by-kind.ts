import { type ContentSource } from "@/application/ports/content-source";
import { type BlogPost, type PostKind } from "@/domain/content/blog-post";
import {
  createGetAllPosts,
  type GetAllPosts,
} from "@/application/use-cases/content/get-all-posts";

/**
 * GetPostsByKind — filter posts by kind, newest-first.
 *
 * `"all"` returns everything. Otherwise a post matches when its `kind` equals
 * the requested kind, OR its `kind` is `"both"` — so a `"both"` post surfaces
 * under both the `"article"` and `"video"` filters. Lifted verbatim from the
 * old `getPostsByKind()` getter.
 */
export interface GetPostsByKindDeps {
  content: ContentSource;
}

export interface GetPostsByKind {
  execute(kind: PostKind | "all"): Promise<BlogPost[]>;
}

export function createGetPostsByKind(
  deps: GetPostsByKindDeps,
): GetPostsByKind {
  const { content } = deps;
  const getAllPosts: GetAllPosts = createGetAllPosts({ content });

  return {
    async execute(kind: PostKind | "all") {
      const all = await getAllPosts.execute();
      if (kind === "all") return all;
      return all.filter((p) => p.kind === kind || p.kind === "both");
    },
  };
}

import { type ContentSource } from "@/application/ports/content-source";
import {
  createGetAllPosts,
  type GetAllPosts,
} from "@/application/use-cases/content/get-all-posts";

/** A tag and the number of posts that carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

/**
 * GetAllTags — tag frequency across all posts, sorted by count descending.
 * Lifted verbatim from the old `getAllTags()` getter: counts are accumulated in
 * first-seen order (a `Map`), then the entries are sorted by `count` descending
 * (`b.count - a.count`), which leaves equal-count tags in first-seen order.
 */
export interface GetAllTagsDeps {
  content: ContentSource;
}

export interface GetAllTags {
  execute(): Promise<TagCount[]>;
}

export function createGetAllTags(deps: GetAllTagsDeps): GetAllTags {
  const { content } = deps;
  const getAllPosts: GetAllPosts = createGetAllPosts({ content });

  return {
    async execute() {
      const posts = await getAllPosts.execute();
      const counts = new Map<string, number>();
      for (const p of posts) {
        for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
    },
  };
}

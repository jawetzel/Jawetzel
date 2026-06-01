import { describe, it, expect } from "vitest";
import { type BlogPost } from "@/domain/content/blog-post";
import { type GetAllPosts } from "@/application/use-cases/content/get-all-posts";
import {
  createSearchBlog,
  rankPosts,
  type SearchBlogArgs,
} from "./search-blog";

function post(slug: string, over: Partial<BlogPost> = {}): BlogPost {
  return {
    slug,
    date: "2026-01-01",
    title: slug,
    description: "",
    tags: [],
    kind: "article",
    bodyMd: "",
    ...over,
  };
}

describe("rankPosts (pure ranking)", () => {
  it("scores title×3 above description×2 above tag(2)/body×1", () => {
    const posts = [
      post("title-hit", { title: "alpha title" }),
      post("desc-hit", { description: "alpha desc" }),
      post("body-hit", { bodyMd: "alpha body" }),
    ];
    const result = rankPosts(posts, { q: "alpha" });
    expect(result.posts.map((p) => p.slug)).toEqual([
      "title-hit", // 3
      "desc-hit", // 2
      "body-hit", // 1
    ]);
    expect(result.total).toBe(3);
  });

  it("tag substring match adds a flat 2 (only once, regardless of tag count)", () => {
    const posts = [
      post("tagged", { tags: ["alpha", "alphabet"] }),
      post("body-only", { bodyMd: "alpha" }),
    ];
    const result = rankPosts(posts, { q: "alpha" });
    // tagged scores 2 (flat), body-only scores 1.
    expect(result.posts.map((p) => p.slug)).toEqual(["tagged", "body-only"]);
  });

  it("sums repeated occurrences within body", () => {
    const posts = [
      post("twice", { bodyMd: "alpha alpha" }),
      post("once", { bodyMd: "alpha" }),
    ];
    const result = rankPosts(posts, { q: "alpha" });
    expect(result.posts[0].slug).toBe("twice");
  });

  it("tie-break: equal score → date descending (localeCompare)", () => {
    const posts = [
      post("older", { title: "alpha", date: "2026-01-01" }),
      post("newer", { title: "alpha", date: "2026-06-01" }),
      post("mid", { title: "alpha", date: "2026-03-01" }),
    ];
    const result = rankPosts(posts, { q: "alpha" });
    expect(result.posts.map((p) => p.slug)).toEqual(["newer", "mid", "older"]);
  });

  it("empty q keeps all posts (no score filter)", () => {
    const posts = [post("a"), post("b")];
    const result = rankPosts(posts, {});
    expect(result.query).toBeNull();
    expect(result.tag).toBeNull();
    expect(result.total).toBe(2);
    expect(result.posts.map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("non-empty q drops zero-score posts", () => {
    const posts = [
      post("match", { title: "alpha" }),
      post("miss", { title: "beta" }),
    ];
    const result = rankPosts(posts, { q: "alpha" });
    expect(result.total).toBe(1);
    expect(result.posts.map((p) => p.slug)).toEqual(["match"]);
    expect(result.query).toBe("alpha");
  });

  it("exact tag filter uses tags.includes and combines with q", () => {
    const posts = [
      post("ts-alpha", { title: "alpha", tags: ["ts"] }),
      post("ts-beta", { title: "beta", tags: ["ts"] }),
      post("js-alpha", { title: "alpha", tags: ["js"] }),
    ];
    // tag filters to ts-*, then q="alpha" drops ts-beta (zero score).
    const result = rankPosts(posts, { q: "alpha", tag: "ts" });
    expect(result.posts.map((p) => p.slug)).toEqual(["ts-alpha"]);
    expect(result.tag).toBe("ts");
  });

  it("tag filter is exact, not substring", () => {
    const posts = [
      post("exact", { tags: ["ts"] }),
      post("superstring", { tags: ["typescript"] }),
    ];
    const result = rankPosts(posts, { tag: "ts" });
    expect(result.posts.map((p) => p.slug)).toEqual(["exact"]);
  });

  it("clamps limit: 50 → 10, 0 → 1, default → 5", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      post(`p${i}`, { date: `2026-01-${String(i + 1).padStart(2, "0")}` }),
    );
    expect(rankPosts(many, { limit: 50 }).posts).toHaveLength(10);
    expect(rankPosts(many, { limit: 0 }).posts).toHaveLength(1);
    expect(rankPosts(many, {}).posts).toHaveLength(5);
    expect(rankPosts(many, { limit: 50 }).total).toBe(20);
  });

  it("maps BlogHit fields and url format", () => {
    const posts = [
      post("slug-x", {
        title: "Title X",
        description: "Desc X",
        date: "2026-05-31",
        tags: ["a", "b"],
        kind: "video",
      }),
    ];
    const [hit] = rankPosts(posts, {}).posts;
    expect(hit).toEqual({
      slug: "slug-x",
      title: "Title X",
      description: "Desc X",
      date: "2026-05-31",
      tags: ["a", "b"],
      kind: "video",
      url: "/blog/slug-x",
    });
  });
});

describe("SearchBlog (use-case over a fake GetAllPosts)", () => {
  function fakeGetAllPosts(posts: BlogPost[]): GetAllPosts & { calls: number } {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async execute() {
        calls++;
        return posts;
      },
    };
  }

  it("delegates to the composed content read and ranks the result", async () => {
    const getAllPosts = fakeGetAllPosts([
      post("match", { title: "alpha" }),
      post("miss", { title: "beta" }),
    ]);
    const args: SearchBlogArgs = { q: "alpha" };
    const result = await createSearchBlog({ getAllPosts }).execute(args);

    expect(getAllPosts.calls).toBe(1);
    expect(result).toEqual(rankPosts(await getAllPosts.execute(), args));
    expect(result.posts.map((p) => p.slug)).toEqual(["match"]);
  });
});

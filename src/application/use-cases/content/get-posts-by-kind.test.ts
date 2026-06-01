import { describe, it, expect } from "vitest";
import { BLOG_DIR } from "./get-all-posts";
import { createGetPostsByKind } from "./get-posts-by-kind";
import { FakeContentSource, entry } from "./get-all-posts.test";

describe("GetPostsByKind", () => {
  const seed = () =>
    new FakeContentSource({
      [BLOG_DIR]: [
        entry("2026-04-17-art.json", { slug: "art", kind: "article" }),
        entry("2026-04-16-vid.json", { slug: "vid", kind: "video" }),
        entry("2026-04-15-both.json", { slug: "both", kind: "both" }),
      ],
    });

  it("returns everything for 'all'", async () => {
    const result = await createGetPostsByKind({ content: seed() }).execute(
      "all",
    );
    expect(result.map((p) => p.slug)).toEqual(["art", "vid", "both"]);
  });

  it("'article' matches articles AND 'both' posts", async () => {
    const result = await createGetPostsByKind({ content: seed() }).execute(
      "article",
    );
    expect(result.map((p) => p.slug)).toEqual(["art", "both"]);
  });

  it("'video' matches videos AND 'both' posts", async () => {
    const result = await createGetPostsByKind({ content: seed() }).execute(
      "video",
    );
    expect(result.map((p) => p.slug)).toEqual(["vid", "both"]);
  });

  it("'both' matches only posts of kind 'both'", async () => {
    const result = await createGetPostsByKind({ content: seed() }).execute(
      "both",
    );
    expect(result.map((p) => p.slug)).toEqual(["both"]);
  });
});

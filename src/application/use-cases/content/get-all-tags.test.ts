import { describe, it, expect } from "vitest";
import { BLOG_DIR } from "./get-all-posts";
import { createGetAllTags } from "./get-all-tags";
import { FakeContentSource, entry } from "./get-all-posts.test";

describe("GetAllTags", () => {
  it("counts tag frequency across all posts, sorted by count descending", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [
        entry("2026-04-17-a.json", { tags: ["ai", "next"] }),
        entry("2026-04-16-b.json", { tags: ["ai", "rust"] }),
        entry("2026-04-15-c.json", { tags: ["ai"] }),
        entry("2026-04-14-d.json", { tags: ["next"] }),
      ],
    });

    const result = await createGetAllTags({ content }).execute();

    expect(result).toEqual([
      { tag: "ai", count: 3 },
      { tag: "next", count: 2 },
      { tag: "rust", count: 1 },
    ]);
  });

  it("returns an empty list when there are no posts", async () => {
    const content = new FakeContentSource({});
    const result = await createGetAllTags({ content }).execute();
    expect(result).toEqual([]);
  });
});

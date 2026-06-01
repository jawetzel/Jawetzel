import { describe, it, expect } from "vitest";
import { BLOG_DIR } from "./get-all-posts";
import { createGetPostBySlug } from "./get-post-by-slug";
import { FakeContentSource, entry } from "./get-all-posts.test";

describe("GetPostBySlug", () => {
  it("returns the matching post", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [
        entry("2026-04-17-alpha.json", { slug: "alpha", title: "Alpha" }),
        entry("2026-04-10-beta.json", { slug: "beta", title: "Beta" }),
      ],
    });

    const result = await createGetPostBySlug({ content }).execute("beta");

    expect(result?.slug).toBe("beta");
    expect(result?.title).toBe("Beta");
  });

  it("matches the filename-derived slug when no explicit slug is set", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [entry("2026-04-17-hello-world.json", {})],
    });

    const result = await createGetPostBySlug({ content }).execute(
      "2026-04-17-hello-world",
    );

    expect(result?.slug).toBe("2026-04-17-hello-world");
  });

  it("returns null when no post matches the slug", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [entry("2026-04-17-alpha.json", { slug: "alpha" })],
    });

    const result = await createGetPostBySlug({ content }).execute("missing");

    expect(result).toBeNull();
  });
});

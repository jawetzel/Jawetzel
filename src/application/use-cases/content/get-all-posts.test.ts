import { describe, it, expect } from "vitest";
import {
  type ContentBase,
  type ContentSource,
  type NamedJsonEntry,
} from "@/application/ports/content-source";
import { type BlogPost } from "@/domain/content/blog-post";
import { createGetAllPosts, BLOG_DIR } from "./get-all-posts";

/**
 * In-memory fake: `readJsonCollectionWithNames` returns the seeded entries
 * verbatim (in insertion order), so the test asserts the use-case's
 * parsing/skip/ordering rules, not the source's. The other reads aren't used by
 * the blog use-cases.
 */
export class FakeContentSource implements ContentSource {
  readonly namedReads: { dir: string; base: ContentBase | undefined }[] = [];
  constructor(
    private readonly named: Record<string, NamedJsonEntry<unknown>[]>,
  ) {}
  async readJson<T>(): Promise<T> {
    throw new Error("not used");
  }
  async readJsonCollection<T>(): Promise<T[]> {
    throw new Error("not used");
  }
  async readJsonCollectionWithNames<T>(
    relativeDir: string,
    base?: ContentBase,
  ): Promise<NamedJsonEntry<T>[]> {
    this.namedReads.push({ dir: relativeDir, base });
    return (this.named[relativeDir] ?? []) as NamedJsonEntry<T>[];
  }
}

export function entry(
  name: string,
  data: Partial<BlogPost> = {},
): NamedJsonEntry<Partial<BlogPost>> {
  return { name, data };
}

describe("GetAllPosts", () => {
  it("reads the repo-root blog directory and sorts newest-first by date", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [
        entry("2026-04-10-older.json", { title: "older" }),
        entry("2026-04-17-newer.json", { title: "newer" }),
        entry("2026-04-12-middle.json", { title: "middle" }),
      ],
    });

    const result = await createGetAllPosts({ content }).execute();

    expect(result.map((p) => p.title)).toEqual(["newer", "middle", "older"]);
    expect(content.namedReads).toEqual([
      { dir: BLOG_DIR, base: "repo-root" },
    ]);
  });

  it("defaults slug and date from the filename when absent in the JSON", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [entry("2026-04-17-hello-world.json", {})],
    });

    const [post] = await createGetAllPosts({ content }).execute();

    expect(post.slug).toBe("2026-04-17-hello-world");
    expect(post.date).toBe("2026-04-17");
    expect(post.title).toBe("(untitled)");
    expect(post.description).toBe("");
    expect(post.tags).toEqual([]);
    expect(post.kind).toBe("article");
    expect(post.bodyMd).toBe("");
  });

  it("prefers explicit slug/date over the filename-derived defaults", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [
        entry("2026-04-17-hello-world.json", {
          slug: "custom-slug",
          date: "2025-01-01",
        }),
      ],
    });

    const [post] = await createGetAllPosts({ content }).execute();

    expect(post.slug).toBe("custom-slug");
    expect(post.date).toBe("2025-01-01");
  });

  it("skips files whose name starts with _ or .", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [
        entry("_2026-04-17-draft.json", { title: "draft" }),
        entry(".2026-04-17-hidden.json", { title: "hidden" }),
        entry("2026-04-17-real.json", { title: "real" }),
      ],
    });

    const result = await createGetAllPosts({ content }).execute();

    expect(result.map((p) => p.title)).toEqual(["real"]);
  });

  it("skips files that aren't date-prefixed", async () => {
    const content = new FakeContentSource({
      [BLOG_DIR]: [
        entry("not-a-date.json", { title: "nope" }),
        entry("2026-04-17-ok.json", { title: "ok" }),
      ],
    });

    const result = await createGetAllPosts({ content }).execute();

    expect(result.map((p) => p.title)).toEqual(["ok"]);
  });

  it("returns an empty list when the directory has no posts", async () => {
    const content = new FakeContentSource({});
    const result = await createGetAllPosts({ content }).execute();
    expect(result).toEqual([]);
  });
});

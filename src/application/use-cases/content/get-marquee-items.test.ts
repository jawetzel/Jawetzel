import { describe, it, expect } from "vitest";
import { type ContentSource } from "@/application/ports/content-source";
import { createGetMarqueeItems } from "./get-marquee-items";

/**
 * In-memory fake: returns the seeded array as-is for known files, and throws an
 * ENOENT-coded error for missing files — mirroring how `FsJsonContentSource`
 * surfaces a missing file (so the use-case's missing → [] guard is exercised).
 */
class FakeContentSource implements ContentSource {
  readonly reads: string[] = [];
  constructor(private readonly docs: Record<string, unknown>) {}
  async readJson<T>(relativePath: string): Promise<T> {
    this.reads.push(relativePath);
    if (!(relativePath in this.docs)) {
      const err = new Error(`ENOENT: no such file: ${relativePath}`) as
        NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return this.docs[relativePath] as T;
  }
  async readJsonCollection<T>(): Promise<T[]> {
    throw new Error("not used by GetMarqueeItems");
  }
  async readJsonCollectionWithNames(): Promise<never[]> {
    throw new Error("not used by GetMarqueeItems");
  }
}

const sample: string[] = ["Legacy Modernization", "Solo SaaS Builds", "AI Chat Assistants"];

describe("GetMarqueeItems", () => {
  it("returns the marquee array as-is, read through the content source", async () => {
    const content = new FakeContentSource({ "marquee.json": sample });
    const result = await createGetMarqueeItems({ content }).execute();

    expect(result).toBe(sample);
    expect(content.reads).toEqual(["marquee.json"]);
  });

  it("returns [] when the file is missing (ENOENT guard preserved)", async () => {
    const content = new FakeContentSource({});
    const result = await createGetMarqueeItems({ content }).execute();

    expect(result).toEqual([]);
  });
});

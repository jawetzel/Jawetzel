import { describe, it, expect } from "vitest";
import { type ContentSource } from "@/application/ports/content-source";
import { type Testimonial } from "@/domain/content/testimonial";
import { createGetTestimonials } from "./get-testimonials";

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
    throw new Error("not used by GetTestimonials");
  }
  async readJsonCollectionWithNames(): Promise<never[]> {
    throw new Error("not used by GetTestimonials");
  }
}

const sample: Testimonial[] = [
  { quote: "Shipped exactly what we agreed to.", name: "A. Client", role: "CTO" },
  {
    quote: "Overcommunicated on scope.",
    name: "B. Client",
    role: "Founder",
    company: "Acme",
    avatarUrl: "/avatars/b.png",
  },
];

describe("GetTestimonials", () => {
  it("returns the testimonials array as-is, read through the content source", async () => {
    const content = new FakeContentSource({ "testimonials.json": sample });
    const result = await createGetTestimonials({ content }).execute();

    expect(result).toBe(sample);
    expect(content.reads).toEqual(["testimonials.json"]);
  });

  it("returns [] when the file is missing (ENOENT guard preserved)", async () => {
    const content = new FakeContentSource({});
    const result = await createGetTestimonials({ content }).execute();

    expect(result).toEqual([]);
  });
});

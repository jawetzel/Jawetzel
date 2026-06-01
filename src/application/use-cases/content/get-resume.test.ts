import { describe, it, expect } from "vitest";
import { type ContentSource } from "@/application/ports/content-source";
import { type ResumeData } from "@/domain/content/resume";
import { createGetResume } from "./get-resume";

class FakeContentSource implements ContentSource {
  readonly reads: string[] = [];
  constructor(private readonly docs: Record<string, unknown>) {}
  async readJson<T>(relativePath: string): Promise<T> {
    this.reads.push(relativePath);
    if (!(relativePath in this.docs)) {
      throw new Error(`no content doc: ${relativePath}`);
    }
    return this.docs[relativePath] as T;
  }
  async readJsonCollection<T>(): Promise<T[]> {
    throw new Error("not used by GetResume");
  }
  async readJsonCollectionWithNames(): Promise<never[]> {
    throw new Error("not used by GetResume");
  }
}

const sample: ResumeData = {
  name: "Joshua Wetzel",
  title: "Full Stack Software Engineer",
  location: "Greater Baton Rouge, LA",
  email: "jawetzel615@gmail.com",
  links: [],
  summary: ["A summary line."],
  experience: [],
  education: [],
  skills: [],
};

describe("GetResume", () => {
  it("returns the resume document read through the content source", async () => {
    const content = new FakeContentSource({ "resume.json": sample });
    const result = await createGetResume({ content }).execute();

    expect(result).toBe(sample);
    expect(content.reads).toEqual(["resume.json"]);
  });
});

import { describe, it, expect } from "vitest";
import { FsJsonContentSource } from "./fs-json-content-source";
import { type ResumeData } from "@/domain/content/resume";
import { type ProjectCaseStudy } from "@/domain/content/project";

/**
 * Integration-ish: runs against the real bundled content (no external I/O),
 * confirming the adapter reads + parses from `src/content/` and memoizes.
 */
describe("FsJsonContentSource", () => {
  it("reads and parses a real content file (resume.json)", async () => {
    const source = new FsJsonContentSource();
    const resume = await source.readJson<ResumeData>("resume.json");

    expect(typeof resume.name).toBe("string");
    expect(Array.isArray(resume.experience)).toBe(true);
  });

  it("memoizes — repeated reads return the same parsed object", async () => {
    const source = new FsJsonContentSource();
    const a = await source.readJson("resume.json");
    const b = await source.readJson("resume.json");

    expect(a).toBe(b);
  });

  it("reads + parses every .json in a real content directory (projects)", async () => {
    const source = new FsJsonContentSource();
    const projects =
      await source.readJsonCollection<ProjectCaseStudy>("projects");

    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) {
      expect(typeof p.slug).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(Array.isArray(p.stack)).toBe(true);
    }
  });

  it("memoizes collection reads — repeated reads return the same array", async () => {
    const source = new FsJsonContentSource();
    const a = await source.readJsonCollection("projects");
    const b = await source.readJsonCollection("projects");

    expect(a).toBe(b);
  });

  it("returns an empty list for a missing directory", async () => {
    const source = new FsJsonContentSource();
    const result = await source.readJsonCollection("does-not-exist-dir");

    expect(result).toEqual([]);
  });

  it("reads a content directory with filenames (projects)", async () => {
    const source = new FsJsonContentSource();
    const entries = await source.readJsonCollectionWithNames<{
      name?: string;
    }>("projects");

    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.name.endsWith(".json")).toBe(true);
      expect(typeof e.data).toBe("object");
    }
  });

  it("memoizes named reads — repeated reads return the same array", async () => {
    const source = new FsJsonContentSource();
    const a = await source.readJsonCollectionWithNames("projects");
    const b = await source.readJsonCollectionWithNames("projects");

    expect(a).toBe(b);
  });

  it("returns an empty list for a missing named directory (repo-root base)", async () => {
    const source = new FsJsonContentSource();
    const result = await source.readJsonCollectionWithNames(
      "does-not-exist-dir",
      "repo-root",
    );

    expect(result).toEqual([]);
  });
});

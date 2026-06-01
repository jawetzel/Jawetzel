import { describe, it, expect } from "vitest";
import { type ContentSource } from "@/application/ports/content-source";
import { type ProjectCaseStudy } from "@/domain/content/project";
import { createGetAllProjects, PROJECTS_DIR } from "./get-all-projects";

/**
 * In-memory fake: `readJsonCollection` returns the seeded array verbatim (in
 * insertion order), so the test asserts the use-case's ordering, not the
 * source's.
 */
class FakeContentSource implements ContentSource {
  readonly dirReads: string[] = [];
  constructor(private readonly collections: Record<string, unknown[]>) {}
  async readJson<T>(): Promise<T> {
    throw new Error("not used");
  }
  async readJsonCollection<T>(relativeDir: string): Promise<T[]> {
    this.dirReads.push(relativeDir);
    return (this.collections[relativeDir] ?? []) as T[];
  }
  async readJsonCollectionWithNames(): Promise<never[]> {
    throw new Error("not used");
  }
}

function project(
  slug: string,
  over: Partial<ProjectCaseStudy> = {},
): ProjectCaseStudy {
  return {
    slug,
    name: slug,
    tagline: "",
    stack: [],
    problem: "",
    actions: [],
    outcome: "",
    underTheHood: "",
    ...over,
  };
}

describe("GetAllProjects", () => {
  it("reads the projects directory and sorts by `order` ascending", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [
        project("c", { order: 3 }),
        project("a", { order: 1 }),
        project("b", { order: 2 }),
      ],
    });

    const result = await createGetAllProjects({ content }).execute();

    expect(result.map((p) => p.slug)).toEqual(["a", "b", "c"]);
    expect(content.dirReads).toEqual([PROJECTS_DIR]);
  });

  it("sorts projects without an `order` last (`?? 99`)", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [
        project("no-order"),
        project("first", { order: 1 }),
        project("second", { order: 2 }),
      ],
    });

    const result = await createGetAllProjects({ content }).execute();

    expect(result.map((p) => p.slug)).toEqual(["first", "second", "no-order"]);
  });

  it("returns an empty list when the directory has no projects", async () => {
    const content = new FakeContentSource({});
    const result = await createGetAllProjects({ content }).execute();
    expect(result).toEqual([]);
  });
});

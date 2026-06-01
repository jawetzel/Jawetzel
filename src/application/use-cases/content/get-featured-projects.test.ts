import { describe, it, expect } from "vitest";
import { type ContentSource } from "@/application/ports/content-source";
import { type ProjectCaseStudy } from "@/domain/content/project";
import { PROJECTS_DIR } from "./get-all-projects";
import {
  createGetFeaturedProjects,
  FEATURED_CAP,
} from "./get-featured-projects";

class FakeContentSource implements ContentSource {
  constructor(private readonly collections: Record<string, unknown[]>) {}
  async readJson<T>(): Promise<T> {
    throw new Error("not used");
  }
  async readJsonCollection<T>(relativeDir: string): Promise<T[]> {
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

describe("GetFeaturedProjects", () => {
  it("returns only featured projects, sorted by `order` ascending", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [
        project("plain-a", { order: 1 }),
        project("feat-b", { featured: true, order: 3 }),
        project("feat-a", { featured: true, order: 2 }),
        project("plain-b", { order: 4 }),
      ],
    });

    const result = await createGetFeaturedProjects({ content }).execute();

    expect(result.map((p) => p.slug)).toEqual(["feat-a", "feat-b"]);
  });

  it("caps the home strip at four even when more are featured", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [
        project("f5", { featured: true, order: 5 }),
        project("f1", { featured: true, order: 1 }),
        project("f3", { featured: true, order: 3 }),
        project("f2", { featured: true, order: 2 }),
        project("f4", { featured: true, order: 4 }),
        project("f6", { featured: true, order: 6 }),
      ],
    });

    const result = await createGetFeaturedProjects({ content }).execute();

    expect(result).toHaveLength(FEATURED_CAP);
    expect(result.map((p) => p.slug)).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("returns fewer than the cap when fewer are featured", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [
        project("f1", { featured: true, order: 1 }),
        project("f2", { featured: true, order: 2 }),
        project("plain", { order: 3 }),
      ],
    });

    const result = await createGetFeaturedProjects({ content }).execute();

    expect(result.map((p) => p.slug)).toEqual(["f1", "f2"]);
  });
});

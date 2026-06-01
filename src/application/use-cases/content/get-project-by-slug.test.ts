import { describe, it, expect } from "vitest";
import { type ContentSource } from "@/application/ports/content-source";
import { type ProjectCaseStudy } from "@/domain/content/project";
import { PROJECTS_DIR } from "./get-all-projects";
import { createGetProjectBySlug } from "./get-project-by-slug";

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

function project(slug: string): ProjectCaseStudy {
  return {
    slug,
    name: slug,
    tagline: "",
    stack: [],
    problem: "",
    actions: [],
    outcome: "",
    underTheHood: "",
  };
}

describe("GetProjectBySlug", () => {
  it("returns the matching project", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [project("alpha"), project("beta")],
    });

    const result = await createGetProjectBySlug({ content }).execute("beta");

    expect(result?.slug).toBe("beta");
  });

  it("returns null when no project matches the slug", async () => {
    const content = new FakeContentSource({
      [PROJECTS_DIR]: [project("alpha")],
    });

    const result = await createGetProjectBySlug({ content }).execute("missing");

    expect(result).toBeNull();
  });
});

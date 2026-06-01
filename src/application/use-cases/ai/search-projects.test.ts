import { describe, it, expect } from "vitest";
import { type ProjectCaseStudy } from "@/domain/content/project";
import { type GetAllProjects } from "@/application/use-cases/content/get-all-projects";
import {
  createSearchProjects,
  rankProjects,
  type SearchProjectsArgs,
} from "./search-projects";

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

describe("rankProjects (pure ranking)", () => {
  it("scores name×4 above tagline×3 above stack(3)/problem/outcome/highlight(1)", () => {
    const projects = [
      project("name-hit", { name: "alpha widget" }),
      project("tagline-hit", { tagline: "the alpha tagline" }),
      project("stack-hit", { stack: ["Alpha"] }),
      project("problem-hit", { problem: "alpha problem" }),
      project("outcome-hit", { outcome: "alpha outcome" }),
      project("highlight-hit", { highlights: ["alpha highlight"] }),
    ];

    const result = rankProjects(projects, { q: "alpha" });

    // name(4) > tagline(3) > stack(3, but stack is 3 vs tagline 3 — order is a tie-break below)
    expect(result.projects.map((p) => p.slug).slice(0, 2)).toEqual([
      "name-hit",
      "tagline-hit",
    ]);
    // problem/outcome/highlight all score 1 and rank below the 3/4 ones.
    expect(result.projects.map((p) => p.slug)).toContain("problem-hit");
    expect(result.total).toBe(6);
  });

  it("sums repeated occurrences within a field", () => {
    const projects = [
      project("twice", { name: "alpha alpha" }),
      project("once", { name: "alpha" }),
    ];
    const result = rankProjects(projects, { q: "alpha" });
    expect(result.projects[0].slug).toBe("twice");
  });

  it("tie-break: equal score → featured first, then order ascending", () => {
    // All match only via tagline (score 3), so scores tie.
    const projects = [
      project("b-feat-2", { tagline: "x", featured: true, order: 2 }),
      project("c-unfeat", { tagline: "x", featured: false, order: 0 }),
      project("a-feat-1", { tagline: "x", featured: true, order: 1 }),
    ];
    const result = rankProjects(projects, { q: "x" });
    expect(result.projects.map((p) => p.slug)).toEqual([
      "a-feat-1",
      "b-feat-2",
      "c-unfeat",
    ]);
  });

  it("missing order sorts as 99 in the tie-break", () => {
    const projects = [
      project("no-order", { tagline: "x", featured: true }),
      project("order-1", { tagline: "x", featured: true, order: 1 }),
    ];
    const result = rankProjects(projects, { q: "x" });
    expect(result.projects.map((p) => p.slug)).toEqual(["order-1", "no-order"]);
  });

  it("empty q keeps all projects (no score filter)", () => {
    const projects = [project("a"), project("b"), project("c")];
    const result = rankProjects(projects, {});
    expect(result.query).toBeNull();
    expect(result.total).toBe(3);
    expect(result.projects.map((p) => p.slug)).toEqual(["a", "b", "c"]);
  });

  it("non-empty q drops zero-score projects", () => {
    const projects = [
      project("match", { name: "alpha" }),
      project("miss", { name: "beta" }),
    ];
    const result = rankProjects(projects, { q: "alpha" });
    expect(result.total).toBe(1);
    expect(result.projects.map((p) => p.slug)).toEqual(["match"]);
    expect(result.query).toBe("alpha");
  });

  it("featured_only filter applies before scoring", () => {
    const projects = [
      project("feat", { name: "alpha", featured: true }),
      project("unfeat", { name: "alpha", featured: false }),
    ];
    const result = rankProjects(projects, { q: "alpha", featured_only: true });
    expect(result.projects.map((p) => p.slug)).toEqual(["feat"]);
  });

  it("clamps limit: 50 → 10, 0 → 1, default → 5", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      project(`p${i}`, { order: i }),
    );
    expect(rankProjects(many, { limit: 50 }).projects).toHaveLength(10);
    expect(rankProjects(many, { limit: 0 }).projects).toHaveLength(1);
    expect(rankProjects(many, {}).projects).toHaveLength(5);
    // total reflects the full ranked count, not the clamped slice.
    expect(rankProjects(many, { limit: 50 }).total).toBe(20);
  });

  it("maps ProjectHit fields with correct defaults and url format", () => {
    const projects = [
      project("slug-x", {
        name: "Name X",
        tagline: "Tag X",
        stack: ["TS"],
        problem: "the problem text",
        url: "https://example.com",
        featured: true,
        status: "live",
      }),
    ];
    const [hit] = rankProjects(projects, {}).projects;
    expect(hit).toEqual({
      slug: "slug-x",
      name: "Name X",
      tagline: "Tag X",
      stack: ["TS"],
      status: "live",
      featured: true,
      external_url: "https://example.com",
      url: "/projects/slug-x",
      brief: "the problem text",
    });
  });

  it("null-coalesces status and external_url; featured defaults false", () => {
    const projects = [project("bare", { problem: "p" })];
    const [hit] = rankProjects(projects, {}).projects;
    expect(hit.status).toBeNull();
    expect(hit.external_url).toBeNull();
    expect(hit.featured).toBe(false);
  });

  it("truncate cuts on word boundary when last space is past n*0.5", () => {
    // n=240. Build a string > 240 chars where a space sits past 120.
    const head = "a".repeat(200);
    const problem = `${head} tail-word that-runs-well-past-the-limit-${"z".repeat(
      60,
    )}`;
    const [hit] = rankProjects([project("t", { problem })], {}).projects;
    // Cut at 240, then back to the last space within [0,240).
    const cut = problem.slice(0, 240);
    const lastSpace = cut.lastIndexOf(" ");
    expect(hit.brief).toBe(cut.slice(0, lastSpace) + "…");
    expect(hit.brief.endsWith("…")).toBe(true);
  });

  it("truncate hard-cuts when the only space is in the first half", () => {
    // A single space at position 10 (< 120), rest one long token > 240.
    const problem = "first-word " + "x".repeat(300);
    const [hit] = rankProjects([project("t", { problem })], {}).projects;
    expect(hit.brief).toBe(problem.slice(0, 240) + "…");
  });

  it("truncate leaves short strings unchanged (no ellipsis)", () => {
    const problem = "short";
    const [hit] = rankProjects([project("t", { problem })], {}).projects;
    expect(hit.brief).toBe("short");
  });
});

describe("SearchProjects (use-case over a fake GetAllProjects)", () => {
  function fakeGetAllProjects(projects: ProjectCaseStudy[]): GetAllProjects & {
    calls: number;
  } {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async execute() {
        calls++;
        return projects;
      },
    };
  }

  it("delegates to the composed content read and ranks the result", async () => {
    const getAllProjects = fakeGetAllProjects([
      project("match", { name: "alpha" }),
      project("miss", { name: "beta" }),
    ]);
    const args: SearchProjectsArgs = { q: "alpha" };
    const result = await createSearchProjects({ getAllProjects }).execute(args);

    expect(getAllProjects.calls).toBe(1);
    expect(result).toEqual(rankProjects(await getAllProjects.execute(), args));
    expect(result.projects.map((p) => p.slug)).toEqual(["match"]);
  });
});

import { describe, it, expect } from "vitest";
import { type ResumeData } from "@/domain/content/resume";
import { type GetResume } from "@/application/use-cases/content/get-resume";
import {
  createGetResumeSection,
  selectResumeSection,
  type GetResumeArgs,
} from "./get-resume-section";

function resume(over: Partial<ResumeData> = {}): ResumeData {
  return {
    name: "Joshua Wetzel",
    title: "Software Developer",
    location: "Baton Rouge, LA",
    email: "josh@example.com",
    links: [{ label: "GitHub", href: "https://github.com/jawetzel" }],
    summary: ["line one", "line two"],
    experience: [
      {
        company: "Acme",
        role: "Engineer",
        start: "2020",
        end: "2024",
        bullets: ["did a thing"],
      },
    ],
    education: [
      { school: "LSU", degree: "BS", start: "2012", end: "2016" },
    ],
    skills: [{ group: "Languages", items: ["TypeScript"] }],
    projects: [{ name: "Portfolio" }],
    ...over,
  };
}

describe("selectResumeSection (pure section switch)", () => {
  it("returns the summary slice", () => {
    const r = resume();
    expect(selectResumeSection(r, { section: "summary" })).toEqual({
      section: "summary",
      data: { summary: r.summary },
    });
  });

  it("returns the experience slice", () => {
    const r = resume();
    expect(selectResumeSection(r, { section: "experience" })).toEqual({
      section: "experience",
      data: { experience: r.experience },
    });
  });

  it("returns the education slice", () => {
    const r = resume();
    expect(selectResumeSection(r, { section: "education" })).toEqual({
      section: "education",
      data: { education: r.education },
    });
  });

  it("returns the skills slice", () => {
    const r = resume();
    expect(selectResumeSection(r, { section: "skills" })).toEqual({
      section: "skills",
      data: { skills: r.skills },
    });
  });

  it("returns the projects slice", () => {
    const r = resume();
    expect(selectResumeSection(r, { section: "projects" })).toEqual({
      section: "projects",
      data: { projects: r.projects },
    });
  });

  it("assembles the contact slice WITHOUT phone when absent", () => {
    const r = resume({ phone: undefined });
    const result = selectResumeSection(r, { section: "contact" });
    expect(result).toEqual({
      section: "contact",
      data: {
        name: r.name,
        title: r.title,
        location: r.location,
        email: r.email,
        links: r.links,
      },
    });
    // The key must be absent, not present-and-undefined.
    expect(result.section === "contact" && "phone" in result.data).toBe(false);
  });

  it("assembles the contact slice WITH phone when present", () => {
    const r = resume({ phone: "+15555550123" });
    const result = selectResumeSection(r, { section: "contact" });
    expect(result).toEqual({
      section: "contact",
      data: {
        name: r.name,
        title: r.title,
        location: r.location,
        email: r.email,
        phone: "+15555550123",
        links: r.links,
      },
    });
  });

  it("returns the full doc for explicit 'all'", () => {
    const r = resume();
    expect(selectResumeSection(r, { section: "all" })).toEqual({
      section: "all",
      data: r,
    });
  });

  it("defaults to 'all' when section is omitted", () => {
    const r = resume();
    expect(selectResumeSection(r, {})).toEqual({ section: "all", data: r });
  });

  it("falls through to 'all' for an unrecognized section", () => {
    const r = resume();
    // Cast to bypass the type guard — mirrors the default branch behavior.
    const result = selectResumeSection(r, {
      section: "bogus",
    } as unknown as GetResumeArgs);
    expect(result).toEqual({ section: "all", data: r });
  });
});

describe("GetResumeSection (use-case over a fake GetResume)", () => {
  function fakeGetResume(r: ResumeData): GetResume & { calls: number } {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async execute() {
        calls++;
        return r;
      },
    };
  }

  it("delegates to the composed GetResume read and selects the section", async () => {
    const r = resume({ phone: "+15555550123" });
    const getResume = fakeGetResume(r);
    const result = await createGetResumeSection({ getResume }).execute({
      section: "contact",
    });
    expect(getResume.calls).toBe(1);
    expect(result).toEqual(selectResumeSection(r, { section: "contact" }));
  });

  it("returns the full doc by default", async () => {
    const r = resume();
    const result = await createGetResumeSection({
      getResume: fakeGetResume(r),
    }).execute({});
    expect(result).toEqual({ section: "all", data: r });
  });
});

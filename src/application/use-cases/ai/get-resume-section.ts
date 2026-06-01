import { type ResumeData } from "@/domain/content/resume";
import { type GetResume } from "@/application/use-cases/content/get-resume";

/**
 * GetResumeSection — the `get_resume` chat tool's section-selection logic,
 * lifted out of `src/lib/ai/tools/get-resume.ts` so the section switch (and the
 * `contact` assembly's `phone`-only-when-present shaping) is pure and
 * unit-testable without any I/O. The use-case composes the existing `GetResume`
 * content read (the only data it needs).
 *
 * Behavior is preserved byte-for-byte from the flat tool: the same section
 * names, the `contact` object's field order + conditional `phone` spread, and
 * the `all` default (covering both an explicit `"all"` and an omitted/unknown
 * section).
 */

export interface GetResumeArgs {
  section?:
    | "all"
    | "summary"
    | "experience"
    | "education"
    | "skills"
    | "projects"
    | "contact";
}

export type GetResumeResult =
  | { section: "all"; data: ResumeData }
  | { section: "summary"; data: { summary: string[] } }
  | { section: "experience"; data: { experience: ResumeData["experience"] } }
  | { section: "education"; data: { education: ResumeData["education"] } }
  | { section: "skills"; data: { skills: ResumeData["skills"] } }
  | { section: "projects"; data: { projects: ResumeData["projects"] } }
  | {
      section: "contact";
      data: {
        name: string;
        title: string;
        location: string;
        email: string;
        phone?: string;
        links: ResumeData["links"];
      };
    };

/**
 * selectResumeSection — the pure section switch. Given the full resume doc and
 * the requested section, return the scoped DTO. No I/O — unit-tested directly.
 * `contact` includes `phone` only when present; an omitted or unrecognized
 * section falls through to `all`.
 */
export function selectResumeSection(
  resume: ResumeData,
  args: GetResumeArgs,
): GetResumeResult {
  const section = args.section ?? "all";
  switch (section) {
    case "summary":
      return { section, data: { summary: resume.summary } };
    case "experience":
      return { section, data: { experience: resume.experience } };
    case "education":
      return { section, data: { education: resume.education } };
    case "skills":
      return { section, data: { skills: resume.skills } };
    case "projects":
      return { section, data: { projects: resume.projects } };
    case "contact":
      return {
        section,
        data: {
          name: resume.name,
          title: resume.title,
          location: resume.location,
          email: resume.email,
          ...(resume.phone && { phone: resume.phone }),
          links: resume.links,
        },
      };
    case "all":
    default:
      return { section: "all", data: resume };
  }
}

export interface GetResumeSectionDeps {
  getResume: GetResume;
}

export interface GetResumeSection {
  execute(args: GetResumeArgs): Promise<GetResumeResult>;
}

export function createGetResumeSection(
  deps: GetResumeSectionDeps,
): GetResumeSection {
  const { getResume } = deps;

  return {
    async execute(args) {
      const resume = await getResume.execute();
      return selectResumeSection(resume, args);
    },
  };
}

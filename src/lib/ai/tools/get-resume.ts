/**
 * Tool: fetch resume sections. The whole doc is small enough to return
 * wholesale, but the assistant can narrow to a section to keep its context
 * tight when the user's question is scoped ("what's his .NET experience?").
 */

import { getResume, type ResumeData } from "@/lib/resume";

export const getResumeTool = {
  type: "function" as const,
  function: {
    name: "get_resume",
    description:
      "Fetch Joshua's resume, either the full document or a single section. Use whenever the user asks about his background, experience, education, skills, or contact info.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: [
            "all",
            "summary",
            "experience",
            "education",
            "skills",
            "projects",
            "contact",
          ],
          description:
            "Which slice of the resume to return. 'all' returns the full structured doc. 'contact' returns name/title/location/email/phone/links.",
        },
      },
    },
  },
};

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
  | { section: "summary"; data: { summary: string } }
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

export async function executeGetResume(
  args: GetResumeArgs,
): Promise<GetResumeResult> {
  const resume = getResume();
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

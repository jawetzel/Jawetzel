/**
 * Tool: fetch resume sections. The whole doc is small enough to return
 * wholesale, but the assistant can narrow to a section to keep its context
 * tight when the user's question is scoped ("what's his .NET experience?").
 *
 * The OpenAI tool *descriptor* below stays here (LLM-coupled config, migrated
 * later with the chat + `LlmGateway` slice). The section-selection logic and
 * the result DTO moved into the `GetResumeSection` application use-case;
 * `executeGetResume` is now a thin delegate that resolves it from the content
 * container. The `*Args`/result types are re-exported from the use-case so the
 * tool registry's imports are unchanged.
 */

import { createContentContainer } from "@/composition/content";
import {
  type GetResumeArgs,
  type GetResumeResult,
} from "@/application/use-cases/ai/get-resume-section";

export {
  type GetResumeArgs,
  type GetResumeResult,
} from "@/application/use-cases/ai/get-resume-section";

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

export async function executeGetResume(
  args: GetResumeArgs,
): Promise<GetResumeResult> {
  return createContentContainer().getResumeSection.execute(args);
}

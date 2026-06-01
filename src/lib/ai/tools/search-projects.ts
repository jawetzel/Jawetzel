/**
 * Tool: search portfolio projects by keyword. Returns enough context for
 * the assistant to summarize + link back to each case study.
 *
 * The OpenAI tool *descriptor* below stays here (it's LLM-coupled config,
 * migrated later with the chat + `LlmGateway` slice). The ranking/scoring/
 * shaping logic and the result DTOs moved into the `SearchProjects`
 * application use-case; `executeSearchProjects` is now a thin delegate that
 * resolves it from the content container. The `*Args`/result types are
 * re-exported from the use-case so the tool registry's imports are unchanged.
 */

import { createContentContainer } from "@/composition/content";
import {
  type SearchProjectsArgs,
  type SearchProjectsResult,
} from "@/application/use-cases/ai/search-projects";

export {
  type SearchProjectsArgs,
  type ProjectHit,
  type SearchProjectsResult,
} from "@/application/use-cases/ai/search-projects";

export const searchProjectsTool = {
  type: "function" as const,
  function: {
    name: "search_projects",
    description:
      "Search Joshua's portfolio projects by keyword. Use when the user asks what he's built, wants to see something in a specific stack, or references a project. Return value includes a URL back to the full case study.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Free-text keyword matched against name, tagline, stack, problem, outcome, and highlights. Omit to list every project.",
        },
        featured_only: {
          type: "boolean",
          description: "Only return featured projects.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5, max 10).",
        },
      },
    },
  },
};

export async function executeSearchProjects(
  args: SearchProjectsArgs,
): Promise<SearchProjectsResult> {
  return createContentContainer().searchProjects.execute(args);
}

/**
 * Tool: search blog posts by keyword or tag. Returns a ranked list the
 * assistant can summarize and link back to.
 *
 * The OpenAI tool *descriptor* below stays here (LLM-coupled config, migrated
 * later with the chat + `LlmGateway` slice). The ranking/tag-filter/shaping
 * logic and the result DTOs moved into the `SearchBlog` application use-case;
 * `executeSearchBlog` is now a thin delegate that resolves it from the content
 * container. The `*Args`/result types are re-exported from the use-case so the
 * tool registry's imports are unchanged.
 */

import { createContentContainer } from "@/composition/content";
import {
  type SearchBlogArgs,
  type SearchBlogResult,
} from "@/application/use-cases/ai/search-blog";

export {
  type SearchBlogArgs,
  type BlogHit,
  type SearchBlogResult,
} from "@/application/use-cases/ai/search-blog";

export const searchBlogTool = {
  type: "function" as const,
  function: {
    name: "search_blog",
    description:
      "Search Joshua's blog posts by keyword or tag. Use when the user asks what he's written about, wants to read about a topic, or references a post he might have published.",
    parameters: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Free-text keyword matched against title, description, tags, and body.",
        },
        tag: {
          type: "string",
          description: "Exact tag filter. Combines with q when both supplied.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5, max 10).",
        },
      },
    },
  },
};

export async function executeSearchBlog(
  args: SearchBlogArgs,
): Promise<SearchBlogResult> {
  return createContentContainer().searchBlog.execute(args);
}

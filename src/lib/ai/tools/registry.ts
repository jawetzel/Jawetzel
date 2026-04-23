/**
 * Central tool registry for the portfolio assistant. The chat lib builds
 * the `tools` array it sends to OpenAI from this list, and routes tool
 * calls back through `dispatchTool`.
 */

import {
  executeFindThreadColor,
  findThreadColorTool,
  type FindThreadColorArgs,
} from "./find-thread-color";
import {
  executeSearchBlog,
  searchBlogTool,
  type SearchBlogArgs,
} from "./search-blog";
import {
  executeSearchProjects,
  searchProjectsTool,
  type SearchProjectsArgs,
} from "./search-projects";
import {
  executeGetResume,
  getResumeTool,
  type GetResumeArgs,
} from "./get-resume";

export const toolSchemas = [
  findThreadColorTool,
  searchBlogTool,
  searchProjectsTool,
  getResumeTool,
];

/**
 * Run a tool by name. Throws on unknown tool or on invalid args shape —
 * callers should catch and return an error message to the model so it can
 * recover.
 */
export async function dispatchTool(
  name: string,
  rawArgs: string,
): Promise<unknown> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    throw new Error(`Tool ${name} received non-JSON arguments.`);
  }

  switch (name) {
    case "find_thread_color":
      return executeFindThreadColor(args as FindThreadColorArgs);
    case "search_blog":
      return executeSearchBlog(args as SearchBlogArgs);
    case "search_projects":
      return executeSearchProjects(args as SearchProjectsArgs);
    case "get_resume":
      return executeGetResume(args as GetResumeArgs);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

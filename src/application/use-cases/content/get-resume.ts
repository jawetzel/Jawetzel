import { type ContentSource } from "@/application/ports/content-source";
import { type ResumeData } from "@/domain/content/resume";

/**
 * GetResume — read the resume document. Thin today (the resume is a single JSON
 * doc with no shaping), but it owns the seam: the page and the `get_resume` chat
 * tool both go through this use-case, so neither touches the filesystem and both
 * are testable against a fake `ContentSource`.
 */
export interface GetResumeDeps {
  content: ContentSource;
}

export interface GetResume {
  execute(): Promise<ResumeData>;
}

export function createGetResume(deps: GetResumeDeps): GetResume {
  const { content } = deps;

  return {
    async execute() {
      return content.readJson<ResumeData>("resume.json");
    },
  };
}

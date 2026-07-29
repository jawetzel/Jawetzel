import { type SeoTag } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * GetSeoTag — the read behind `/seo/[tag]`.
 *
 * Separate from {@link ListSeoTags} rather than "list and find" at the call
 * site: the workspace page loads on every visit, and the tag list grows with
 * every engagement.
 */

export interface GetSeoTag {
  execute(input: { tag: string }): Promise<SeoTag | null>;
}

export function createGetSeoTag(deps: {
  workspace: SeoWorkspaceRepository;
}): GetSeoTag {
  return {
    async execute(input) {
      return deps.workspace.findTag(input.tag);
    },
  };
}

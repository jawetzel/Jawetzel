import { type SeoTag } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * ListSeoTags — the read behind the tag picker.
 *
 * A `SeoTag` is already a flat, serializable read model, so there is no entity
 * to map; it crosses the RSC boundary as-is.
 */

export interface ListSeoTags {
  execute(): Promise<SeoTag[]>;
}

export function createListSeoTags(deps: {
  workspace: SeoWorkspaceRepository;
}): ListSeoTags {
  return {
    async execute() {
      return deps.workspace.listTags();
    },
  };
}

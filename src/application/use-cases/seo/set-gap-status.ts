import { type GapStatus } from "@/domain/seo/gap-pile";
import { type SeoGapRepository } from "@/application/ports/seo-gap-repository";

/**
 * SetGapStatus — the layer-2 gate.
 *
 * Per keyword rather than per run, because the pile is tag-scoped and a
 * refresh next quarter must not resurrect what was already thrown out.
 * `merge` in the domain is the other half of that guarantee: it refreshes
 * facts and preserves this decision.
 */

export interface SetGapStatusInput {
  tag: string;
  keywords: string[];
  status: GapStatus;
}

export interface SetGapStatus {
  execute(input: SetGapStatusInput): Promise<{ changed: number }>;
}

export function createSetGapStatus(deps: {
  gaps: SeoGapRepository;
}): SetGapStatus {
  return {
    async execute(input) {
      const keywords = [
        ...new Set(
          input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean),
        ),
      ];
      const changed = await deps.gaps.setStatus({
        tag: input.tag,
        keywords,
        status: input.status,
      });
      return { changed };
    },
  };
}

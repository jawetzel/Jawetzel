import { ok, err, type Result } from "@/domain/shared/result";
import { hostKey } from "@/domain/seo/property-id";
import { isValidTag, type SeoTag } from "@/domain/seo/workspace";
import { type SeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository";

/**
 * CreateSeoTag — register a customer tag and the property it pertains to.
 *
 * The tag is what makes working one page at a time cheap: layers 1–2 are
 * property-scoped, so their output is bought once against the tag and every
 * later page run reads it for free. It also carries the per-vertical config
 * (`entitySchema` above all) that would otherwise be re-typed into every
 * analyze call.
 *
 * Re-saving an existing tag updates its config in place. That is deliberate —
 * `entitySchema` is the field most likely to be refined after seeing real
 * output, and forcing a delete/recreate would orphan the tag's run history.
 */

export interface CreateSeoTagInput {
  tag: string;
  label: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  entitySchema: string[];
  urgencyTerms: string[];
  city: string | null;
}

export type CreateSeoTagError = "INVALID_TAG" | "INVALID_DOMAIN";

export interface CreateSeoTag {
  execute(input: CreateSeoTagInput): Promise<Result<SeoTag, CreateSeoTagError>>;
}

export function createCreateSeoTag(deps: {
  workspace: SeoWorkspaceRepository;
  now?: () => Date;
}): CreateSeoTag {
  const now = deps.now ?? (() => new Date());

  return {
    async execute(input) {
      if (!isValidTag(input.tag)) return err("INVALID_TAG");

      const domain = hostKey(input.domain);
      if (domain === "" || !domain.includes(".")) return err("INVALID_DOMAIN");

      const existing = await deps.workspace.findTag(input.tag);
      const tag: SeoTag = {
        tag: input.tag,
        label: input.label.trim() || input.tag,
        domain,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        entitySchema: input.entitySchema,
        urgencyTerms: input.urgencyTerms,
        city: input.city,
        createdAt: existing?.createdAt ?? now().toISOString(),
      };

      await deps.workspace.saveTag(tag);
      return ok(tag);
    },
  };
}

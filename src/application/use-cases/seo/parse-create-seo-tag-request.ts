import { ok, err, type Result } from "@/domain/shared/result";
import { toTagSlug } from "@/domain/seo/workspace";
import { type CreateSeoTagInput } from "@/application/use-cases/seo/create-seo-tag";
import {
  isRecord,
  languageCode,
  positiveInteger,
  requiredString,
  stringArray,
  type FieldError,
} from "@/application/use-cases/seo/request-fields";

/** Structural validation for `POST /api/seo/tags`. */

const DEFAULT_LOCATION_CODE = 2840; // United States
const DEFAULT_LANGUAGE_CODE = "en";
const MAX_LIST_ENTRIES = 50;

export function parseCreateSeoTagRequest(
  body: unknown,
): Result<CreateSeoTagInput, FieldError[]> {
  const errors: FieldError[] = [];
  if (!isRecord(body)) {
    return err([{ field: "body", message: "Expected a JSON object." }]);
  }

  const label = requiredString(
    body.label,
    "label",
    "Required. A human name for this engagement.",
    errors,
  );

  const domain = requiredString(
    body.domain,
    "domain",
    "Required. The property this tag pertains to, e.g. example.com.",
    errors,
  );

  // The slug defaults off the label so the common case needs one field, but a
  // caller who wants a stable key independent of display text may set it.
  const tag =
    typeof body.tag === "string" && body.tag.trim() !== ""
      ? toTagSlug(body.tag)
      : toTagSlug(label);
  if (tag === "") {
    errors.push({
      field: "tag",
      message: "Could not derive a slug — supply `tag` explicitly.",
    });
  }

  const locationCodeValue = positiveInteger(
    body.locationCode,
    "locationCode",
    DEFAULT_LOCATION_CODE,
    errors,
  );
  const languageCodeValue = languageCode(
    body.languageCode,
    "languageCode",
    DEFAULT_LANGUAGE_CODE,
    errors,
  );

  const entitySchema = stringArray(body.entitySchema);
  if (entitySchema === null) {
    errors.push({
      field: "entitySchema",
      message: "Must be an array of fact-type names.",
    });
  } else if (entitySchema.length > MAX_LIST_ENTRIES) {
    errors.push({
      field: "entitySchema",
      message: `At most ${MAX_LIST_ENTRIES} entries.`,
    });
  }

  const urgencyTerms = stringArray(body.urgencyTerms);
  if (urgencyTerms === null) {
    errors.push({
      field: "urgencyTerms",
      message: "Must be an array of terms.",
    });
  } else if (urgencyTerms.length > MAX_LIST_ENTRIES) {
    errors.push({
      field: "urgencyTerms",
      message: `At most ${MAX_LIST_ENTRIES} entries.`,
    });
  }

  let city: string | null = null;
  if (body.city !== undefined && body.city !== null) {
    if (typeof body.city !== "string") {
      errors.push({ field: "city", message: "Must be a string." });
    } else if (body.city.trim() !== "") {
      city = body.city.trim();
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({
    tag,
    label,
    domain,
    locationCode: locationCodeValue,
    languageCode: languageCodeValue,
    entitySchema: entitySchema ?? [],
    urgencyTerms: urgencyTerms ?? [],
    city,
  });
}

import { ok, err, type Result } from "@/domain/shared/result";
import { type StartIntelRunInput } from "@/application/use-cases/seo/start-intel-run";
import {
  isRecord,
  positiveInteger,
  requiredString,
  shareValue,
  stringArray,
  type FieldError,
} from "@/application/use-cases/seo/request-fields";

/** Structural validation for `POST /api/seo/runs` — layer 1's entry point. */

/**
 * The vendor bills per keyword and the competitor signal saturates well before
 * this; a list longer than this is a paste accident, not a strategy.
 */
const MAX_KEYWORDS = 200;
const DEFAULT_MIN_SHARE = 0.1;
const DEFAULT_MAX_COMPETITORS = 12;
const MAX_COMPETITORS = 30;

export function parseStartIntelRunRequest(
  body: unknown,
): Result<StartIntelRunInput, FieldError[]> {
  const errors: FieldError[] = [];
  if (!isRecord(body)) {
    return err([{ field: "body", message: "Expected a JSON object." }]);
  }

  const tag = requiredString(
    body.tag,
    "tag",
    "Required. The customer tag this run belongs to.",
    errors,
  );

  let keywords: string[] = [];
  const raw = stringArray(body.keywords);
  if (raw === null) {
    errors.push({
      field: "keywords",
      message: "Must be an array of keyword strings.",
    });
  } else if (raw.length === 0) {
    errors.push({
      field: "keywords",
      message: "Required. At least one keyword — the set is what defines the competition.",
    });
  } else if (raw.length > MAX_KEYWORDS) {
    errors.push({
      field: "keywords",
      message: `At most ${MAX_KEYWORDS} keywords.`,
    });
  } else {
    keywords = raw;
  }

  const minShare = shareValue(
    body.minShare,
    "minShare",
    DEFAULT_MIN_SHARE,
    errors,
  );

  const maxCompetitors = Math.min(
    positiveInteger(
      body.maxCompetitors,
      "maxCompetitors",
      DEFAULT_MAX_COMPETITORS,
      errors,
    ),
    MAX_COMPETITORS,
  );

  if (errors.length > 0) return err(errors);

  return ok({ tag, keywords, minShare, maxCompetitors });
}

import { ok, err, type Result } from "@/domain/shared/result";
import { DEFAULT_MIN_SHARE } from "@/domain/seo/delta-facts";
import {
  type AnalyzeInclude,
  type AnalyzePageInput,
} from "@/application/use-cases/seo/analyze-page";

/**
 * Structural validation for `POST /api/seo/analyze`, colocated with the use-case
 * whose contract it guards.
 *
 * Two-tier validation, per CLAUDE.md: *structural* checks (shape, types,
 * required, format) happen here at the driving-adapter boundary, before the
 * use-case is invoked; business invariants live in the domain. Keeping the
 * schema next to the use-case rather than in the route handler is what lets a
 * second entry point (a cron job, a server action) validate identically instead
 * of drifting.
 *
 * Hand-rolled rather than Zod because this project carries no schema library and
 * one endpoint is not a reason to add a dependency to every bundle. The contract
 * is the same: unknown fields are ignored, every failure names its field, and a
 * caller never gets a generic "invalid request".
 */

export interface FieldError {
  field: string;
  message: string;
}

/** United States. DataForSEO's numeric location codes, not ISO. */
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = "en";
/** A SERP this fresh is reused instead of re-observed. */
const DEFAULT_MAX_SNAPSHOT_AGE_DAYS = 7;

const VALID_INCLUDES: AnalyzeInclude[] = [
  "provenance",
  "history",
  "serp",
  "facts",
  "keywords",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string array, tolerating a single string and dropping blanks. */
function stringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === "string")) return null;
  return (value as string[]).map((s) => s.trim()).filter((s) => s !== "");
}

export function parseAnalyzePageRequest(
  body: unknown,
): Result<AnalyzePageInput, FieldError[]> {
  const errors: FieldError[] = [];
  if (!isRecord(body)) {
    return err([{ field: "body", message: "Expected a JSON object." }]);
  }

  // ---- url: required, absolute, http(s) ----
  let url = "";
  if (typeof body.url !== "string" || body.url.trim() === "") {
    errors.push({ field: "url", message: "Required. The page URL to analyze." });
  } else {
    try {
      const parsed = new URL(body.url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push({ field: "url", message: "Must be an http(s) URL." });
      } else {
        url = parsed.toString();
      }
    } catch {
      errors.push({
        field: "url",
        message: "Must be an absolute URL, e.g. https://example.com/page.",
      });
    }
  }

  // ---- targetQuery: required ----
  let targetQuery = "";
  if (typeof body.targetQuery !== "string" || body.targetQuery.trim() === "") {
    errors.push({
      field: "targetQuery",
      message: "Required. The query this page is meant to win.",
    });
  } else {
    targetQuery = body.targetQuery.trim();
  }

  // ---- locationCode / languageCode ----
  let locationCode = DEFAULT_LOCATION_CODE;
  if (body.locationCode !== undefined) {
    if (
      typeof body.locationCode !== "number" ||
      !Number.isInteger(body.locationCode) ||
      body.locationCode <= 0
    ) {
      errors.push({
        field: "locationCode",
        message: "Must be a positive integer DataForSEO location code.",
      });
    } else {
      locationCode = body.locationCode;
    }
  }

  let languageCode = DEFAULT_LANGUAGE_CODE;
  if (body.languageCode !== undefined) {
    if (
      typeof body.languageCode !== "string" ||
      !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(body.languageCode)
    ) {
      errors.push({
        field: "languageCode",
        message: "Must be an ISO-639-1 code, e.g. 'en'.",
      });
    } else {
      languageCode = body.languageCode;
    }
  }

  // ---- entitySchema / urgencyTerms: per-vertical config, pure data ----
  const entitySchema = stringArray(body.entitySchema);
  if (entitySchema === null) {
    errors.push({
      field: "entitySchema",
      message: "Must be an array of field names, e.g. ['hardinessZone'].",
    });
  }
  const urgencyTerms = stringArray(body.urgencyTerms);
  if (urgencyTerms === null) {
    errors.push({
      field: "urgencyTerms",
      message: "Must be an array of strings.",
    });
  }

  // ---- city: archetype-A title composition ----
  let city: string | null = null;
  if (body.city !== undefined && body.city !== null) {
    if (typeof body.city !== "string") {
      errors.push({ field: "city", message: "Must be a string." });
    } else if (body.city.trim() !== "") {
      city = body.city.trim();
    }
  }

  // ---- minShare: the one threshold, echoed back in the response ----
  let minShare = DEFAULT_MIN_SHARE;
  if (body.minShare !== undefined) {
    if (
      typeof body.minShare !== "number" ||
      !Number.isFinite(body.minShare) ||
      body.minShare <= 0 ||
      body.minShare > 1
    ) {
      errors.push({
        field: "minShare",
        message: "Must be a number in (0, 1] — the share of competitors using a feature.",
      });
    } else {
      minShare = body.minShare;
    }
  }

  let maxSnapshotAgeDays = DEFAULT_MAX_SNAPSHOT_AGE_DAYS;
  if (body.maxSnapshotAgeDays !== undefined) {
    if (
      typeof body.maxSnapshotAgeDays !== "number" ||
      !Number.isFinite(body.maxSnapshotAgeDays) ||
      body.maxSnapshotAgeDays < 0
    ) {
      errors.push({
        field: "maxSnapshotAgeDays",
        message: "Must be a non-negative number of days. 0 forces a fresh SERP.",
      });
    } else {
      maxSnapshotAgeDays = body.maxSnapshotAgeDays;
    }
  }

  // ---- include: optional response sections ----
  const includeRaw = stringArray(body.include);
  let include: AnalyzeInclude[] = [];
  if (includeRaw === null) {
    errors.push({
      field: "include",
      message: `Must be an array of: ${VALID_INCLUDES.join(", ")}.`,
    });
  } else {
    const unknown = includeRaw.filter(
      (i) => !VALID_INCLUDES.includes(i as AnalyzeInclude),
    );
    if (unknown.length > 0) {
      errors.push({
        field: "include",
        message: `Unknown section(s): ${unknown.join(", ")}. Valid: ${VALID_INCLUDES.join(", ")}.`,
      });
    } else {
      include = includeRaw as AnalyzeInclude[];
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({
    url,
    targetQuery,
    locationCode,
    languageCode,
    entitySchema: entitySchema ?? [],
    urgencyTerms: urgencyTerms ?? [],
    city,
    minShare,
    maxSnapshotAgeDays,
    include,
  });
}

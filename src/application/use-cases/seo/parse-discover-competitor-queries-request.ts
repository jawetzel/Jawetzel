import { ok, err, type Result } from "@/domain/shared/result";
import { type DiscoverCompetitorQueriesInput } from "@/application/use-cases/seo/discover-competitor-queries";

/**
 * Structural validation for `POST /api/seo/competitor-queries`, colocated with
 * the use-case whose contract it guards. Same conventions as the analyze and
 * suggest parsers: hand-rolled (no schema lib in this project), unknown fields
 * ignored, every failure names its field.
 */

export interface FieldError {
  field: string;
  message: string;
}

const DEFAULT_LOCATION_CODE = 2840; // United States (DataForSEO numeric code)
const DEFAULT_LANGUAGE_CODE = "en";
const DEFAULT_MAX_SNAPSHOT_AGE_DAYS = 7;
/** seo.md Part 1 pulls the top 6 competitors; 4 is a cheaper default. */
const DEFAULT_MAX_COMPETITORS = 4;
const MAX_COMPETITORS = 6;
const DEFAULT_MAX_SUGGESTIONS = 10;
const MAX_SUGGESTIONS = 20;
/** More exclusions than this is a caller bug, not a workflow. */
const MAX_EXCLUDE_QUERIES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string array, tolerating a comma-separated string and dropping blanks. */
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

export function parseDiscoverCompetitorQueriesRequest(
  body: unknown,
): Result<DiscoverCompetitorQueriesInput, FieldError[]> {
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

  // ---- targetQuery: required — its SERP defines "the competition" ----
  let targetQuery = "";
  if (typeof body.targetQuery !== "string" || body.targetQuery.trim() === "") {
    errors.push({
      field: "targetQuery",
      message: "Required. The query whose SERP defines the competition.",
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

  // ---- maxCompetitors / maxSuggestions: clamped to sane ceilings ----
  let maxCompetitors = DEFAULT_MAX_COMPETITORS;
  if (body.maxCompetitors !== undefined) {
    if (
      typeof body.maxCompetitors !== "number" ||
      !Number.isInteger(body.maxCompetitors) ||
      body.maxCompetitors <= 0
    ) {
      errors.push({
        field: "maxCompetitors",
        message: "Must be a positive integer.",
      });
    } else {
      maxCompetitors = Math.min(body.maxCompetitors, MAX_COMPETITORS);
    }
  }

  let maxSuggestions = DEFAULT_MAX_SUGGESTIONS;
  if (body.maxSuggestions !== undefined) {
    if (
      typeof body.maxSuggestions !== "number" ||
      !Number.isInteger(body.maxSuggestions) ||
      body.maxSuggestions <= 0
    ) {
      errors.push({
        field: "maxSuggestions",
        message: "Must be a positive integer.",
      });
    } else {
      maxSuggestions = Math.min(body.maxSuggestions, MAX_SUGGESTIONS);
    }
  }

  // ---- excludeQueries: what has already been analyzed this session ----
  let excludeQueries: string[] = [];
  const excludeRaw = stringArray(body.excludeQueries);
  if (excludeRaw === null) {
    errors.push({
      field: "excludeQueries",
      message: "Must be an array of query strings.",
    });
  } else if (excludeRaw.length > MAX_EXCLUDE_QUERIES) {
    errors.push({
      field: "excludeQueries",
      message: `At most ${MAX_EXCLUDE_QUERIES} entries.`,
    });
  } else {
    excludeQueries = excludeRaw;
  }

  // ---- maxSnapshotAgeDays: SERP freshness window ----
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

  if (errors.length > 0) return err(errors);

  return ok({
    url,
    targetQuery,
    locationCode,
    languageCode,
    maxCompetitors,
    maxSuggestions,
    excludeQueries,
    maxSnapshotAgeDays,
  });
}

import { ok, err, type Result } from "@/domain/shared/result";
import { type SuggestQueriesInput } from "@/application/use-cases/seo/suggest-queries";

/**
 * Structural validation for `POST /api/seo/suggest-queries`, colocated with the
 * use-case whose contract it guards. Same conventions as the analyze parser:
 * hand-rolled (no schema lib in this project), unknown fields ignored, every
 * failure names its field.
 */

export interface FieldError {
  field: string;
  message: string;
}

const DEFAULT_LOCATION_CODE = 2840; // United States (DataForSEO numeric code)
const DEFAULT_LANGUAGE_CODE = "en";
const DEFAULT_MAX_CANDIDATES = 10;
const MAX_CANDIDATES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSuggestQueriesRequest(
  body: unknown,
): Result<SuggestQueriesInput, FieldError[]> {
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

  // ---- city: optional locale hint for location-qualified variants ----
  let city: string | null = null;
  if (body.city !== undefined && body.city !== null) {
    if (typeof body.city !== "string") {
      errors.push({ field: "city", message: "Must be a string." });
    } else if (body.city.trim() !== "") {
      city = body.city.trim();
    }
  }

  // ---- maxCandidates: clamp to a sane ceiling ----
  let maxCandidates = DEFAULT_MAX_CANDIDATES;
  if (body.maxCandidates !== undefined) {
    if (
      typeof body.maxCandidates !== "number" ||
      !Number.isInteger(body.maxCandidates) ||
      body.maxCandidates <= 0
    ) {
      errors.push({
        field: "maxCandidates",
        message: "Must be a positive integer.",
      });
    } else {
      maxCandidates = Math.min(body.maxCandidates, MAX_CANDIDATES);
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({ url, locationCode, languageCode, city, maxCandidates });
}

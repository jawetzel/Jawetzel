/**
 * Shared structural-validation primitives for the SEO workspace surface.
 *
 * The three pre-existing parsers (`parse-analyze-page-request` and friends)
 * each hand-roll these; this module exists so the workspace parsers added
 * alongside them do not make that four and five copies. Same conventions
 * throughout: no schema library in this project, unknown fields ignored so
 * adding options later never breaks a caller, and **every failure names its
 * field**.
 */

export interface FieldError {
  field: string;
  message: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A string array, tolerating a comma-separated string and dropping blanks.
 * Returns null when the value is neither, so the caller can name the field.
 */
export function stringArray(value: unknown): string[] | null {
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

/** A non-empty trimmed string, or null. */
export function requiredString(
  value: unknown,
  field: string,
  message: string,
  errors: FieldError[],
): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field, message });
    return "";
  }
  return value.trim();
}

/** A positive integer with a default, e.g. a DataForSEO location code. */
export function positiveInteger(
  value: unknown,
  field: string,
  fallback: number,
  errors: FieldError[],
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    errors.push({ field, message: "Must be a positive integer." });
    return fallback;
  }
  return value;
}

/** An ISO-639-1 language code with a default. */
export function languageCode(
  value: unknown,
  field: string,
  fallback: string,
  errors: FieldError[],
): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(value)) {
    errors.push({ field, message: "Must be an ISO-639-1 code, e.g. 'en'." });
    return fallback;
  }
  return value;
}

/** A number in `(0, 1]`, for share thresholds. */
export function shareValue(
  value: unknown,
  field: string,
  fallback: number,
  errors: FieldError[],
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    errors.push({ field, message: "Must be a number between 0 and 1." });
    return fallback;
  }
  return value;
}

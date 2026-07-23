import { describe, it, expect } from "vitest";
import { isOk, isErr } from "@/domain/shared/result";
import { parseAnalyzePageRequest } from "./parse-analyze-page-request";

const MINIMAL = { url: "https://example.com/page", targetQuery: "plumber" };

function fieldsOf(body: unknown): string[] {
  const result = parseAnalyzePageRequest(body);
  return isErr(result) ? result.error.map((e) => e.field) : [];
}

describe("parseAnalyzePageRequest — required fields", () => {
  it("accepts the minimal body and applies documented defaults", () => {
    const result = parseAnalyzePageRequest(MINIMAL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      url: "https://example.com/page",
      targetQuery: "plumber",
      locationCode: 2840,
      languageCode: "en",
      entitySchema: [],
      urgencyTerms: [],
      city: null,
      minShare: 0.3,
      maxSnapshotAgeDays: 7,
      include: [],
    });
  });

  it("names every offending field rather than failing generically", () => {
    expect(fieldsOf({})).toEqual(["url", "targetQuery"]);
  });

  it("rejects a non-object body", () => {
    expect(fieldsOf("nope")).toEqual(["body"]);
    expect(fieldsOf([1, 2])).toEqual(["body"]);
  });

  it("rejects relative and non-http URLs", () => {
    expect(fieldsOf({ ...MINIMAL, url: "/relative" })).toEqual(["url"]);
    expect(fieldsOf({ ...MINIMAL, url: "file:///etc/passwd" })).toEqual(["url"]);
    expect(fieldsOf({ ...MINIMAL, url: "javascript:alert(1)" })).toEqual(["url"]);
  });

  it("rejects a blank target query", () => {
    expect(fieldsOf({ ...MINIMAL, targetQuery: "   " })).toEqual(["targetQuery"]);
  });

  it("trims whitespace off accepted values", () => {
    const result = parseAnalyzePageRequest({
      url: "  https://example.com/page  ",
      targetQuery: "  plumber fairfield  ",
    });
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.targetQuery).toBe("plumber fairfield");
  });
});

describe("parseAnalyzePageRequest — optional config", () => {
  it("accepts arrays for entitySchema and urgencyTerms", () => {
    const result = parseAnalyzePageRequest({
      ...MINIMAL,
      entitySchema: ["hardinessZone", "  matureHeight  ", ""],
      urgencyTerms: ["emergency", "24/7"],
    });
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.entitySchema).toEqual(["hardinessZone", "matureHeight"]);
    expect(result.value.urgencyTerms).toEqual(["emergency", "24/7"]);
  });

  it("accepts a comma-separated string as a convenience", () => {
    const result = parseAnalyzePageRequest({
      ...MINIMAL,
      entitySchema: "zone, spacing, sun",
    });
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.entitySchema).toEqual(["zone", "spacing", "sun"]);
  });

  it("rejects a non-string array", () => {
    expect(fieldsOf({ ...MINIMAL, entitySchema: [1, 2] })).toEqual([
      "entitySchema",
    ]);
  });

  it("validates the location and language codes", () => {
    expect(fieldsOf({ ...MINIMAL, locationCode: "2840" })).toEqual([
      "locationCode",
    ]);
    expect(fieldsOf({ ...MINIMAL, locationCode: 0 })).toEqual(["locationCode"]);
    expect(fieldsOf({ ...MINIMAL, languageCode: "english" })).toEqual([
      "languageCode",
    ]);
  });

  it("bounds minShare to (0, 1]", () => {
    expect(fieldsOf({ ...MINIMAL, minShare: 0 })).toEqual(["minShare"]);
    expect(fieldsOf({ ...MINIMAL, minShare: 1.5 })).toEqual(["minShare"]);
    const ok1 = parseAnalyzePageRequest({ ...MINIMAL, minShare: 1 });
    expect(isOk(ok1)).toBe(true);
  });

  it("allows maxSnapshotAgeDays 0 to force a fresh SERP", () => {
    const result = parseAnalyzePageRequest({ ...MINIMAL, maxSnapshotAgeDays: 0 });
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.maxSnapshotAgeDays).toBe(0);
    expect(fieldsOf({ ...MINIMAL, maxSnapshotAgeDays: -1 })).toEqual([
      "maxSnapshotAgeDays",
    ]);
  });

  it("treats an empty city string as absent", () => {
    const result = parseAnalyzePageRequest({ ...MINIMAL, city: "   " });
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.city).toBeNull();
  });
});

describe("parseAnalyzePageRequest — include", () => {
  it("accepts the known sections", () => {
    const result = parseAnalyzePageRequest({
      ...MINIMAL,
      include: ["serp", "history"],
    });
    if (!isOk(result)) throw new Error("expected ok");
    expect(result.value.include).toEqual(["serp", "history"]);
  });

  it("names the unknown section and lists the valid ones", () => {
    const result = parseAnalyzePageRequest({ ...MINIMAL, include: ["gossip"] });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error[0].field).toBe("include");
    expect(result.error[0].message).toContain("gossip");
    expect(result.error[0].message).toContain("provenance");
  });

  it("ignores unknown top-level fields instead of rejecting the request", () => {
    const result = parseAnalyzePageRequest({ ...MINIMAL, futureOption: true });
    expect(isOk(result)).toBe(true);
  });
});

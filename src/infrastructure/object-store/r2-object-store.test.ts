import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyEnvPrefix,
  buildPublicUrl,
  contentDispositionFor,
} from "./r2-object-store";

/**
 * Pure-logic tests for the R2 object store. The S3 `send()` calls (upload,
 * download, presign) are thin pass-throughs to the AWS SDK and are **not**
 * unit-testable without an integration/network harness — by design we add no
 * real-network test. What *is* pure and behavior-defining is extracted and
 * covered here: the dev-prefix rule, the public-URL slash/prefix construction,
 * and the presigned-download filename sanitization. Byte-for-byte parity with
 * the old `src/lib/r2.ts` is the gate.
 */

describe("applyEnvPrefix", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefixes the key with dev_ in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(applyEnvPrefix("supplies/current.json")).toBe(
      "dev_supplies/current.json",
    );
  });

  it("leaves the key unchanged in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(applyEnvPrefix("supplies/current.json")).toBe(
      "supplies/current.json",
    );
  });

  it("leaves the key unchanged in test (anything not 'development')", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(applyEnvPrefix("a/b/c")).toBe("a/b/c");
  });
});

describe("buildPublicUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("joins base and key with a single slash (production: no prefix)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(buildPublicUrl("https://cdn.example.com", "embroidery/x.png")).toBe(
      "https://cdn.example.com/embroidery/x.png",
    );
  });

  it("strips trailing slashes off the base", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(buildPublicUrl("https://cdn.example.com///", "k.json")).toBe(
      "https://cdn.example.com/k.json",
    );
  });

  it("strips leading slashes off the (prefixed) key", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(buildPublicUrl("https://cdn.example.com", "///k.json")).toBe(
      "https://cdn.example.com/k.json",
    );
  });

  it("applies the dev_ prefix to the key in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildPublicUrl("https://cdn.example.com", "k.json")).toBe(
      "https://cdn.example.com/dev_k.json",
    );
  });

  it("handles trailing-base + leading-key + dev prefix together", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildPublicUrl("https://cdn.example.com/", "/sub/k.json")).toBe(
      "https://cdn.example.com/dev_/sub/k.json",
    );
  });
});

describe("contentDispositionFor", () => {
  it("builds an attachment Content-Disposition with the filename", () => {
    expect(contentDispositionFor("report.pdf")).toBe(
      'attachment; filename="report.pdf"',
    );
  });

  it("strips double quotes from the filename", () => {
    expect(contentDispositionFor('we"ird".pdf')).toBe(
      'attachment; filename="weird.pdf"',
    );
  });

  it("leaves other characters (incl. the dev_ prefix is never applied) intact", () => {
    // The filename is the user-facing download name and is NOT env-prefixed.
    expect(contentDispositionFor("My Supplies 2026.csv")).toBe(
      'attachment; filename="My Supplies 2026.csv"',
    );
  });
});

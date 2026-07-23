import { describe, it, expect } from "vitest";

import { SITE } from "@/lib/constants";
import { executeBookConsult } from "./book-consult";

describe("executeBookConsult", () => {
  it("returns the Calendly url and email from site constants", async () => {
    const r = await executeBookConsult({});
    expect(r.url).toBe(SITE.calendly);
    expect(r.email).toBe(SITE.email);
    expect(r.duration_minutes).toBe(30);
    expect(r.topic).toBeNull();
  });

  it("normalizes whitespace and caps the topic length", async () => {
    const r = await executeBookConsult({
      topic: "  modernizing   a\nlegacy   dispatch system  ",
    });
    expect(r.topic).toBe("modernizing a legacy dispatch system");

    const long = await executeBookConsult({ topic: "x".repeat(500) });
    expect(long.topic).toHaveLength(120);
  });

  it("treats a non-string or empty topic as absent", async () => {
    const numeric = await executeBookConsult({
      topic: 42 as unknown as string,
    });
    expect(numeric.topic).toBeNull();

    const blank = await executeBookConsult({ topic: "   " });
    expect(blank.topic).toBeNull();
  });
});

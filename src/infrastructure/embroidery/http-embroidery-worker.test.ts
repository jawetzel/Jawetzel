import { describe, it, expect } from "vitest";
import {
  buildTraceQuery,
  buildSampleColorsQuery,
} from "./http-embroidery-worker";
import { WorkerError } from "@/application/ports/embroidery-compute-gateway";

/**
 * Pure-logic tests for the HTTP embroidery worker. The `node:http` `workerPost`
 * send (trace, convert, sample-colors) is a thin pass-through to the Python
 * microservice and is **not** unit-testable without a live server — by design
 * we add no real-network test. What *is* pure and behavior-defining is the
 * querystring construction, extracted into `buildTraceQuery` /
 * `buildSampleColorsQuery` and covered here. Byte-for-byte parity with the old
 * `src/app/embroidery/_lib/worker.ts` encoding is the gate.
 *
 * `URLSearchParams.toString()` percent-encodes commas as `%2C`, which is what
 * the old code already produced — so the assertions match the historical wire
 * format exactly.
 */

describe("buildTraceQuery", () => {
  it("encodes size and stringified colors", () => {
    expect(buildTraceQuery("4in", 6)).toBe("size=4in&colors=6&extract_outline=1");
  });

  it("strips '#' from palette hexes and comma-joins them", () => {
    const qs = buildTraceQuery("4in", 2, ["#ff0000", "#00ff00"]);
    const params = new URLSearchParams(qs);
    expect(params.get("palette")).toBe("ff0000,00ff00");
  });

  it("omits palette when the array is empty", () => {
    const params = new URLSearchParams(buildTraceQuery("4in", 2, []));
    expect(params.has("palette")).toBe(false);
  });

  it("sets extract_outline to '1' when true and '0' when false", () => {
    expect(
      new URLSearchParams(buildTraceQuery("4in", 2, undefined, true)).get(
        "extract_outline",
      ),
    ).toBe("1");
    expect(
      new URLSearchParams(buildTraceQuery("4in", 2, undefined, false)).get(
        "extract_outline",
      ),
    ).toBe("0");
  });

  it("defaults extract_outline to '1' when omitted", () => {
    expect(
      new URLSearchParams(buildTraceQuery("4in", 2)).get("extract_outline"),
    ).toBe("1");
  });

  it("includes clusters (#-stripped) and routes when both arrays are non-empty and equal-length", () => {
    const params = new URLSearchParams(
      buildTraceQuery("4in", 2, undefined, true, {
        clusters: ["#aabbcc", "#112233"],
        routes: [0, 1],
      }),
    );
    expect(params.get("clusters")).toBe("aabbcc,112233");
    expect(params.get("routes")).toBe("0,1");
  });

  it("omits routing when clusters is empty", () => {
    const params = new URLSearchParams(
      buildTraceQuery("4in", 2, undefined, true, { clusters: [], routes: [] }),
    );
    expect(params.has("clusters")).toBe(false);
    expect(params.has("routes")).toBe(false);
  });

  it("omits routing when clusters.length !== routes.length (the guard)", () => {
    const params = new URLSearchParams(
      buildTraceQuery("4in", 2, undefined, true, {
        clusters: ["#aabbcc", "#112233"],
        routes: [0],
      }),
    );
    expect(params.has("clusters")).toBe(false);
    expect(params.has("routes")).toBe(false);
  });

  it("includes skip indices comma-joined when non-empty", () => {
    const params = new URLSearchParams(
      buildTraceQuery("4in", 2, undefined, true, undefined, [1, 3, 5]),
    );
    expect(params.get("skip")).toBe("1,3,5");
  });

  it("omits skip when the array is empty", () => {
    const params = new URLSearchParams(
      buildTraceQuery("4in", 2, undefined, true, undefined, []),
    );
    expect(params.has("skip")).toBe(false);
  });

  it("encodes a fully-populated trace query", () => {
    const params = new URLSearchParams(
      buildTraceQuery(
        "5in",
        3,
        ["#fff", "#000"],
        false,
        { clusters: ["#abc"], routes: [2] },
        [4],
      ),
    );
    expect(params.get("size")).toBe("5in");
    expect(params.get("colors")).toBe("3");
    expect(params.get("palette")).toBe("fff,000");
    expect(params.get("extract_outline")).toBe("0");
    expect(params.get("clusters")).toBe("abc");
    expect(params.get("routes")).toBe("2");
    expect(params.get("skip")).toBe("4");
  });
});

describe("buildSampleColorsQuery", () => {
  it("stringifies n and defaults to 20", () => {
    expect(new URLSearchParams(buildSampleColorsQuery()).get("n")).toBe("20");
    expect(new URLSearchParams(buildSampleColorsQuery(8)).get("n")).toBe("8");
  });

  it("omits full_res by default and sets it to '1' when true", () => {
    expect(new URLSearchParams(buildSampleColorsQuery(20, false)).has("full_res")).toBe(
      false,
    );
    expect(
      new URLSearchParams(buildSampleColorsQuery(20, true)).get("full_res"),
    ).toBe("1");
  });

  it("omits size by default and includes it when provided", () => {
    expect(new URLSearchParams(buildSampleColorsQuery(20, false)).has("size")).toBe(
      false,
    );
    expect(
      new URLSearchParams(buildSampleColorsQuery(20, false, "4in")).get("size"),
    ).toBe("4in");
  });

  it("encodes a fully-populated sample-colors query", () => {
    const params = new URLSearchParams(buildSampleColorsQuery(12, true, "3in"));
    expect(params.get("n")).toBe("12");
    expect(params.get("full_res")).toBe("1");
    expect(params.get("size")).toBe("3in");
  });
});

describe("WorkerError", () => {
  it("is an instanceof Error and WorkerError with the historical message + fields", () => {
    const err = new WorkerError(503, "/trace", "service unavailable");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WorkerError);
    expect(err.name).toBe("WorkerError");
    expect(err.status).toBe(503);
    expect(err.endpoint).toBe("/trace");
    expect(err.body).toBe("service unavailable");
    expect(err.message).toBe("Worker /trace failed: 503 service unavailable");
  });

});

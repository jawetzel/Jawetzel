import { describe, it, expect } from "vitest";
import {
  IDENTITY,
  applyAffine,
  parseD,
  parseTransform,
} from "./path-parser";

/**
 * Pure-rule tests for the SVG path-data parser — relocated verbatim from
 * `src/app/embroidery/_lib/geometry/path-parser.ts`. These assert the parsing
 * behavior the trace → tag pipeline depends on: absolute vs relative commands,
 * the implicit-lineto-after-moveto rule, the close-path point, transform
 * composition order, and the curve-flattening step counts (16 cubic, 12 quad).
 */

describe("parseTransform", () => {
  it("returns IDENTITY for empty / null / undefined", () => {
    expect(parseTransform(null)).toEqual(IDENTITY);
    expect(parseTransform(undefined)).toEqual(IDENTITY);
    expect(parseTransform("")).toEqual(IDENTITY);
  });

  it("parses a translate", () => {
    expect(parseTransform("translate(10, 20)")).toEqual([1, 0, 0, 1, 10, 20]);
  });

  it("parses a single-arg scale as uniform", () => {
    expect(parseTransform("scale(2)")).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it("parses a two-arg scale", () => {
    expect(parseTransform("scale(2, 3)")).toEqual([2, 0, 0, 3, 0, 0]);
  });

  it("parses a raw matrix", () => {
    expect(parseTransform("matrix(1,2,3,4,5,6)")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("composes translate then scale left-to-right (translate applies first)", () => {
    // translate(10,0) then scale(2) — a point at local (1,0) becomes
    // scale->(2,0) then... composition order: the parser multiplies each op
    // into the running matrix, so the result maps p -> translate(scale(p)).
    const t = parseTransform("translate(10, 0) scale(2)");
    expect(applyAffine(t, { x: 1, y: 0 })).toEqual({ x: 12, y: 0 });
  });
});

describe("applyAffine", () => {
  it("applies the matrix to a point", () => {
    expect(applyAffine([2, 0, 0, 3, 5, 7], { x: 1, y: 1 })).toEqual({
      x: 7,
      y: 10,
    });
  });
});

describe("parseD", () => {
  it("parses an absolute M/L line into one subpath", () => {
    const sp = parseD("M 0 0 L 10 0 L 10 10");
    expect(sp).toHaveLength(1);
    expect(sp[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("treats coords after a moveto as implicit linetos", () => {
    // "M 0 0 5 5" — the 5 5 is an implicit L per the SVG spec.
    const sp = parseD("M 0 0 5 5");
    expect(sp[0]).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it("handles relative commands (lowercase)", () => {
    const sp = parseD("M 1 1 l 2 0 l 0 3");
    expect(sp[0]).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 4 },
    ]);
  });

  it("closes a subpath back to its start point on Z", () => {
    const sp = parseD("M 0 0 L 10 0 L 10 10 Z");
    expect(sp[0][sp[0].length - 1]).toEqual({ x: 0, y: 0 });
  });

  it("splits multiple movetos into separate subpaths", () => {
    const sp = parseD("M 0 0 L 1 0 M 5 5 L 6 5");
    expect(sp).toHaveLength(2);
    expect(sp[0]).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(sp[1]).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]);
  });

  it("flattens a cubic into 16 sampled points (plus the moveto)", () => {
    const sp = parseD("M 0 0 C 0 10 10 10 10 0");
    // moveto point + 16 flatten steps
    expect(sp[0]).toHaveLength(17);
    // last sampled point is the curve endpoint
    expect(sp[0][16]).toEqual({ x: 10, y: 0 });
  });

  it("flattens a quadratic into 12 sampled points (plus the moveto)", () => {
    const sp = parseD("M 0 0 Q 5 10 10 0");
    expect(sp[0]).toHaveLength(13);
    expect(sp[0][12]).toEqual({ x: 10, y: 0 });
  });

  it("applies the supplied transform to every emitted point", () => {
    const sp = parseD("M 0 0 L 1 0", parseTransform("translate(100, 200)"));
    expect(sp[0]).toEqual([
      { x: 100, y: 200 },
      { x: 101, y: 200 },
    ]);
  });

  it("skips characters that are not path commands (tokenizer drops them)", () => {
    // 'X' is not in the command set, so the tokenizer discards it and the
    // trailing "1 1" parses as an implicit lineto after the moveto.
    const sp = parseD("M 0 0 X 1 1");
    expect(sp[0]).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("throws when path data starts with a number", () => {
    expect(() => parseD("5 5 L 1 1")).toThrow();
  });
});

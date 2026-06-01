import { describe, it, expect } from "vitest";
import { findRedundantSameColorPaths } from "./enclosure";
import { axisAlignedBbox, absoluteArea } from "./metrics";
import type { PathRecord, Subpath } from "./types";

/**
 * Pure-rule tests for the same-color enclosure dedupe — relocated verbatim from
 * `src/app/embroidery/_lib/geometry/enclosure.ts`. The rule: a path fully
 * enclosed by a *larger same-thread-color* sibling is visually redundant once
 * the enclosing region renders with the same thread, so it's dropped. Only
 * fires across color groups the snap has collapsed onto one thread; different
 * colors are never compared.
 */

/** Build a PathRecord from subpaths, deriving bbox + area like the real pipeline. */
function record(index: number, subpaths: Subpath[]): PathRecord {
  return {
    index,
    d: "",
    layerIndex: 0,
    fillColor: "#000000",
    bboxPx: axisAlignedBbox(subpaths),
    areaPx: absoluteArea(subpaths),
    areaMm2: 0,
    obbWidthMm: 0,
    obbLengthMm: 0,
    aspectRatio: 0,
    principalAngleDeg: 0,
    coversCanvas: false,
    suggestion: { stitch_type: "fill", reason: "" },
    subpaths,
  };
}

function square(x: number, y: number, size: number): Subpath {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

const OUTER = record(0, [square(0, 0, 100)]); // big
const INNER = record(1, [square(40, 40, 20)]); // fully inside OUTER

describe("findRedundantSameColorPaths", () => {
  it("flags an inner path enclosed by a larger same-color sibling", () => {
    const colors = new Map<number, string>([
      [0, "#ff0000"],
      [1, "#ff0000"],
    ]);
    const result = findRedundantSameColorPaths([OUTER, INNER], colors);
    expect(result.has(1)).toBe(true);
    // the enclosing (larger) path is never itself flagged
    expect(result.has(0)).toBe(false);
  });

  it("does not flag when the two paths are different colors", () => {
    const colors = new Map<number, string>([
      [0, "#ff0000"],
      [1, "#00ff00"],
    ]);
    expect(findRedundantSameColorPaths([OUTER, INNER], colors).size).toBe(0);
  });

  it("does not flag two same-color paths that don't overlap", () => {
    const a = record(0, [square(0, 0, 20)]);
    const b = record(1, [square(50, 50, 20)]);
    const colors = new Map<number, string>([
      [0, "#ff0000"],
      [1, "#ff0000"],
    ]);
    expect(findRedundantSameColorPaths([a, b], colors).size).toBe(0);
  });

  it("ignores records with no color mapping", () => {
    const colors = new Map<number, string>([[0, "#ff0000"]]); // INNER unmapped
    expect(findRedundantSameColorPaths([OUTER, INNER], colors).size).toBe(0);
  });

  it("color match is case-insensitive", () => {
    const colors = new Map<number, string>([
      [0, "#FF0000"],
      [1, "#ff0000"],
    ]);
    expect(findRedundantSameColorPaths([OUTER, INNER], colors).has(1)).toBe(
      true,
    );
  });

  it("returns empty for a single path (nothing to enclose)", () => {
    const colors = new Map<number, string>([[0, "#ff0000"]]);
    expect(findRedundantSameColorPaths([OUTER], colors).size).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  absoluteArea,
  axisAlignedBbox,
  centroid,
  orientedBbox,
  signedArea,
} from "./metrics";
import type { Subpath } from "./types";

/**
 * Pure-rule tests for the polygon-metrics helpers — relocated verbatim from
 * `src/app/embroidery/_lib/geometry/metrics.ts`. These feed the prefilter's
 * stitch-type heuristics (area, aspect ratio, principal angle), so the area
 * sign convention, the empty-input guards, and the OBB orientation are the
 * load-bearing behavior.
 */

// A 10×10 axis-aligned square (CCW in SVG's y-down space).
const SQUARE: Subpath = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("axisAlignedBbox", () => {
  it("computes the bounding box of a square", () => {
    expect(axisAlignedBbox([SQUARE])).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("returns a zero box for no points", () => {
    expect(axisAlignedBbox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("signedArea / absoluteArea", () => {
  it("computes the absolute area of a 10×10 square as 100", () => {
    expect(absoluteArea([SQUARE])).toBe(100);
  });

  it("absoluteArea is sign-independent (reversed winding still 100)", () => {
    const reversed = [...SQUARE].reverse();
    expect(absoluteArea([reversed])).toBe(100);
    // signedArea itself flips sign with winding
    expect(Math.sign(signedArea([SQUARE]))).not.toBe(
      Math.sign(signedArea([reversed])),
    );
  });

  it("a hole subpath (opposite winding) subtracts from the total", () => {
    const hole: Subpath = [
      { x: 2, y: 2 },
      { x: 2, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 2 },
    ]; // wound opposite to SQUARE
    // 100 (outer) - 36 (6×6 hole) = 64
    expect(absoluteArea([SQUARE, hole])).toBe(64);
  });
});

describe("centroid", () => {
  it("is the average of all points", () => {
    expect(centroid([SQUARE])).toEqual({ x: 5, y: 5 });
  });

  it("returns origin for no points", () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe("orientedBbox", () => {
  it("returns zeros for no points", () => {
    expect(orientedBbox([])).toEqual({ widthPx: 0, lengthPx: 0, angleDeg: 0 });
  });

  it("measures a long thin horizontal rectangle: length along x", () => {
    const rect: Subpath = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 4 },
      { x: 0, y: 4 },
    ];
    const obb = orientedBbox([rect]);
    expect(obb.lengthPx).toBeCloseTo(40, 5);
    expect(obb.widthPx).toBeCloseTo(4, 5);
    // angle is normalized into [0, 360)
    expect(obb.angleDeg).toBeGreaterThanOrEqual(0);
    expect(obb.angleDeg).toBeLessThan(360);
  });

  it("always reports length >= width", () => {
    const obb = orientedBbox([SQUARE]);
    expect(obb.lengthPx).toBeGreaterThanOrEqual(obb.widthPx);
  });
});

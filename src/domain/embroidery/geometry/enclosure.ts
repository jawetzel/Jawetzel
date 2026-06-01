import { absoluteArea } from "./metrics";
import type { Bbox, PathRecord, Point, Subpath } from "./types";

// Find paths that are fully enclosed by a same-thread-color sibling path —
// these are visually redundant once the underlying path renders, since the
// enclosing region already covers their geometry with the same thread.
//
// This only finds anything when the thread snap has collapsed two trace-time
// color groups onto a single thread. potrace never emits nested same-color
// paths within a single mask (connected components with holes become one
// path under even-odd fill), so within-group dedupe is a no-op; the
// across-group case is the whole point.
//
// `snappedColorByIndex` maps PathRecord.index → final thread hex (lowercased
// or not — we normalize). The returned set is in PathRecord.index space and
// can be fed directly to stripPaths alongside other drop indices.
export function findRedundantSameColorPaths(
  records: PathRecord[],
  snappedColorByIndex: Map<number, string>,
): Set<number> {
  const byColor = new Map<string, PathRecord[]>();
  for (const r of records) {
    const c = snappedColorByIndex.get(r.index);
    if (!c) continue;
    const key = c.toLowerCase();
    let arr = byColor.get(key);
    if (!arr) {
      arr = [];
      byColor.set(key, arr);
    }
    arr.push(r);
  }

  const redundant = new Set<number>();
  for (const arr of byColor.values()) {
    if (arr.length < 2) continue;
    // Larger paths first so smaller candidates only test against potentially-
    // enclosing ones. Ties don't matter — a same-area path can't strictly
    // contain another.
    arr.sort((a, b) => b.areaPx - a.areaPx);
    for (let i = 1; i < arr.length; i++) {
      const A = arr[i];
      const probe = interiorProbe(A);
      if (!probe) continue;
      // Verify the probe is actually inside A's filled region. For
      // irregular shapes (U-shapes, multi-lobe blobs) the centroid of the
      // largest subpath can land outside the fill — in that case we'd
      // rather skip than risk a false positive.
      if (!pointInSubpathsEvenOdd(probe, A.subpaths)) continue;
      for (let j = 0; j < i; j++) {
        const B = arr[j];
        if (!bboxContains(B.bboxPx, A.bboxPx)) continue;
        if (pointInSubpathsEvenOdd(probe, B.subpaths)) {
          redundant.add(A.index);
          break;
        }
      }
    }
  }
  return redundant;
}

function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function interiorProbe(record: PathRecord): Point | null {
  if (record.subpaths.length === 0) return null;
  // Centroid of the largest subpath. Potrace emits the outer contour first
  // and holes after, so the largest is the outer ring — its centroid lies
  // inside the filled region for typical blob-like embroidery shapes.
  let best = record.subpaths[0];
  let bestArea = absoluteArea([best]);
  for (let i = 1; i < record.subpaths.length; i++) {
    const a = absoluteArea([record.subpaths[i]]);
    if (a > bestArea) {
      best = record.subpaths[i];
      bestArea = a;
    }
  }
  if (best.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const p of best) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / best.length, y: sy / best.length };
}

// Even-odd ray cast across every subpath. A hole flips the inside flag back
// off, which matches potrace's fill rule.
function pointInSubpathsEvenOdd(p: Point, subpaths: Subpath[]): boolean {
  let inside = false;
  for (const sp of subpaths) {
    const n = sp.length;
    if (n < 3) continue;
    let j = n - 1;
    for (let i = 0; i < n; j = i++) {
      const xi = sp[i].x;
      const yi = sp[i].y;
      const xj = sp[j].x;
      const yj = sp[j].y;
      if (
        yi > p.y !== yj > p.y &&
        p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

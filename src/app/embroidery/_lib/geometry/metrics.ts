import type { Bbox, Point, Subpath } from "./types";

export function axisAlignedBbox(subpaths: Subpath[]): Bbox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sp of subpaths) {
    for (const p of sp) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Shoelace sum per subpath. Potrace uses even-odd winding, so holes have
// opposite orientation and cancel when we take the absolute value of the total.
export function signedArea(subpaths: Subpath[]): number {
  let total = 0;
  for (const sp of subpaths) {
    let a = 0;
    for (let i = 0; i < sp.length; i++) {
      const j = (i + 1) % sp.length;
      a += sp[i].x * sp[j].y - sp[j].x * sp[i].y;
    }
    total += a / 2;
  }
  return total;
}

export function absoluteArea(subpaths: Subpath[]): number {
  return Math.abs(signedArea(subpaths));
}

export function centroid(subpaths: Subpath[]): Point {
  let sx = 0, sy = 0, n = 0;
  for (const sp of subpaths) {
    for (const p of sp) {
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  if (n === 0) return { x: 0, y: 0 };
  return { x: sx / n, y: sy / n };
}

export type OBB = {
  widthPx: number;
  lengthPx: number;
  angleDeg: number;
};

export function orientedBbox(subpaths: Subpath[]): OBB {
  const c = centroid(subpaths);
  let sxx = 0, syy = 0, sxy = 0, n = 0;
  for (const sp of subpaths) {
    for (const p of sp) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
      n++;
    }
  }
  if (n === 0) return { widthPx: 0, lengthPx: 0, angleDeg: 0 };
  sxx /= n; syy /= n; sxy /= n;

  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const sp of subpaths) {
    for (const p of sp) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const u = dx * cosA + dy * sinA;
      const v = -dx * sinA + dy * cosA;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }
  const along = uMax - uMin;
  const across = vMax - vMin;
  const length = Math.max(along, across);
  const width = Math.min(along, across);
  // atan2 can return the minor-axis direction for edge cases; rotate 90° when across wins.
  const rawDeg = along >= across ? angle * 180 / Math.PI : angle * 180 / Math.PI + 90;
  const angleDeg = ((rawDeg % 360) + 360) % 360;

  return { widthPx: width, lengthPx: length, angleDeg };
}

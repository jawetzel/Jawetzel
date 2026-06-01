import type { Point, Subpath } from "./types";

export type Affine = readonly [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function parseTransform(s: string | null | undefined): Affine {
  if (!s) return IDENTITY;
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const op = m[1];
    const nums = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let na = 1, nb = 0, nc = 0, nd = 1, ne = 0, nf = 0;
    if (op === "translate") {
      ne = nums[0] ?? 0;
      nf = nums[1] ?? 0;
    } else if (op === "scale") {
      na = nums[0] ?? 1;
      nd = nums[1] ?? na;
    } else if (op === "matrix") {
      na = nums[0] ?? 1; nb = nums[1] ?? 0;
      nc = nums[2] ?? 0; nd = nums[3] ?? 1;
      ne = nums[4] ?? 0; nf = nums[5] ?? 0;
    }
    const ra = a * na + c * nb;
    const rb = b * na + d * nb;
    const rc = a * nc + c * nd;
    const rd = b * nc + d * nd;
    const reC = a * ne + c * nf + e;
    const rfC = b * ne + d * nf + f;
    a = ra; b = rb; c = rc; d = rd; e = reC; f = rfC;
  }
  return [a, b, c, d, e, f];
}

export function applyAffine(t: Affine, p: Point): Point {
  return {
    x: t[0] * p.x + t[2] * p.y + t[4],
    y: t[1] * p.x + t[3] * p.y + t[5],
  };
}

const COMMAND = /[MmLlHhVvCcSsQqTtZz]/;
const NUMBER = /^-?\d*\.?\d+(?:[eE][+-]?\d+)?/;

function tokenize(d: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let i = 0;
  while (i < d.length) {
    const ch = d[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") {
      i++;
      continue;
    }
    if (COMMAND.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    const match = NUMBER.exec(d.slice(i));
    if (!match) {
      i++;
      continue;
    }
    tokens.push(Number(match[0]));
    i += match[0].length;
  }
  return tokens;
}

const CUBIC_STEPS = 16;
const QUAD_STEPS = 12;

function flattenCubic(
  out: Subpath,
  t: Affine,
  p0: Point, p1: Point, p2: Point, p3: Point,
): void {
  for (let s = 1; s <= CUBIC_STEPS; s++) {
    const u = s / CUBIC_STEPS;
    const iu = 1 - u;
    const x = iu * iu * iu * p0.x + 3 * iu * iu * u * p1.x + 3 * iu * u * u * p2.x + u * u * u * p3.x;
    const y = iu * iu * iu * p0.y + 3 * iu * iu * u * p1.y + 3 * iu * u * u * p2.y + u * u * u * p3.y;
    out.push(applyAffine(t, { x, y }));
  }
}

function flattenQuadratic(
  out: Subpath,
  t: Affine,
  p0: Point, p1: Point, p2: Point,
): void {
  for (let s = 1; s <= QUAD_STEPS; s++) {
    const u = s / QUAD_STEPS;
    const iu = 1 - u;
    const x = iu * iu * p0.x + 2 * iu * u * p1.x + u * u * p2.x;
    const y = iu * iu * p0.y + 2 * iu * u * p1.y + u * u * p2.y;
    out.push(applyAffine(t, { x, y }));
  }
}

export function parseD(d: string, transform: Affine = IDENTITY): Subpath[] {
  const tokens = tokenize(d);
  const subpaths: Subpath[] = [];
  let current: Subpath = [];
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;
  let prevC2: Point | null = null;
  let prevQ1: Point | null = null;
  let cmd = "";
  let i = 0;

  const takeNum = (): number => {
    const v = tokens[i++];
    if (typeof v !== "number") {
      throw new Error(`Expected number at token ${i - 1}, got ${String(v)}`);
    }
    return v;
  };

  const addPoint = (x: number, y: number): void => {
    current.push(applyAffine(transform, { x, y }));
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") {
      cmd = t;
      i++;
    } else if (!cmd) {
      throw new Error("Path data starts with a number, not a command");
    }
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    switch (upper) {
      case "M": {
        let x = takeNum(), y = takeNum();
        if (rel) { x += cx; y += cy; }
        if (current.length > 0) subpaths.push(current);
        current = [];
        cx = x; cy = y; startX = x; startY = y;
        addPoint(x, y);
        cmd = rel ? "l" : "L";
        prevC2 = null; prevQ1 = null;
        break;
      }
      case "L": {
        let x = takeNum(), y = takeNum();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y;
        addPoint(x, y);
        prevC2 = null; prevQ1 = null;
        break;
      }
      case "H": {
        let x = takeNum();
        if (rel) x += cx;
        cx = x;
        addPoint(x, cy);
        prevC2 = null; prevQ1 = null;
        break;
      }
      case "V": {
        let y = takeNum();
        if (rel) y += cy;
        cy = y;
        addPoint(cx, y);
        prevC2 = null; prevQ1 = null;
        break;
      }
      case "C": {
        let x1 = takeNum(), y1 = takeNum();
        let x2 = takeNum(), y2 = takeNum();
        let x = takeNum(), y = takeNum();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        flattenCubic(current, transform, { x: cx, y: cy }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y });
        cx = x; cy = y;
        prevC2 = { x: x2, y: y2 };
        prevQ1 = null;
        break;
      }
      case "S": {
        let x2 = takeNum(), y2 = takeNum();
        let x = takeNum(), y = takeNum();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        const c1: Point = prevC2
          ? { x: 2 * cx - prevC2.x, y: 2 * cy - prevC2.y }
          : { x: cx, y: cy };
        flattenCubic(current, transform, { x: cx, y: cy }, c1, { x: x2, y: y2 }, { x, y });
        cx = x; cy = y;
        prevC2 = { x: x2, y: y2 };
        prevQ1 = null;
        break;
      }
      case "Q": {
        let x1 = takeNum(), y1 = takeNum();
        let x = takeNum(), y = takeNum();
        if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
        flattenQuadratic(current, transform, { x: cx, y: cy }, { x: x1, y: y1 }, { x, y });
        cx = x; cy = y;
        prevQ1 = { x: x1, y: y1 };
        prevC2 = null;
        break;
      }
      case "T": {
        let x = takeNum(), y = takeNum();
        if (rel) { x += cx; y += cy; }
        const q1: Point = prevQ1
          ? { x: 2 * cx - prevQ1.x, y: 2 * cy - prevQ1.y }
          : { x: cx, y: cy };
        flattenQuadratic(current, transform, { x: cx, y: cy }, q1, { x, y });
        cx = x; cy = y;
        prevQ1 = q1;
        prevC2 = null;
        break;
      }
      case "Z": {
        addPoint(startX, startY);
        cx = startX; cy = startY;
        if (current.length > 0) subpaths.push(current);
        current = [];
        prevC2 = null; prevQ1 = null;
        break;
      }
      default:
        throw new Error(`Unknown path command: ${cmd}`);
    }
  }
  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

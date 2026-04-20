export type Point = { x: number; y: number };
export type Subpath = Point[];

export type ViewBox = { x: number; y: number; w: number; h: number };
export type Bbox = { x: number; y: number; w: number; h: number };

export type StitchKind = "fill" | "satin" | "running" | "skip";

export type Suggestion = {
  stitch_type: StitchKind;
  reason: string;
};

export type PathRecord = {
  index: number;
  d: string;
  layerIndex: number;
  fillColor: string;
  bboxPx: Bbox;
  areaPx: number;
  areaMm2: number;
  obbWidthMm: number;
  obbLengthMm: number;
  aspectRatio: number;
  principalAngleDeg: number;
  coversCanvas: boolean;
  suggestion: Suggestion;
};

// Minimal default thread palette. Quantized trace colors get snapped to the
// nearest entry so the emitted SVG uses consistent, nameable colors. Real
// production use would swap this for a Madeira/Isacord/etc. palette loaded
// from a data file.

export type ThreadColor = { hex: string; name: string };

export const DEFAULT_THREAD_PALETTE: ThreadColor[] = [
  { hex: "#000000", name: "Black" },
  { hex: "#ffffff", name: "White" },
  { hex: "#c21b17", name: "Red" },
  { hex: "#e67000", name: "Orange" },
  { hex: "#f6c24f", name: "Yellow" },
  { hex: "#228b22", name: "Green" },
  { hex: "#1e5298", name: "Blue" },
  { hex: "#0b1f4a", name: "Navy" },
  { hex: "#6b2d5c", name: "Purple" },
  { hex: "#f06292", name: "Pink" },
  { hex: "#6d4c2b", name: "Brown" },
  { hex: "#c08457", name: "Tan" },
  { hex: "#808080", name: "Gray" },
  { hex: "#c0c0c0", name: "Silver" },
  { hex: "#f5ecc7", name: "Cream" },
  { hex: "#74b9e7", name: "Sky" },
];

export function snapToPalette(
  hex: string,
  palette: ThreadColor[] = DEFAULT_THREAD_PALETTE,
): ThreadColor {
  const { r, g, b } = hexToRgb(hex);
  let best = palette[0];
  let bestD = Infinity;
  for (const c of palette) {
    const cr = hexToRgb(c.hex);
    const d = (r - cr.r) ** 2 + (g - cr.g) ** 2 + (b - cr.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

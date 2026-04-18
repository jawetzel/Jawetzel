// Derive a WCAG-aware palette from a single anchor color.
// Anchor: #55D6D0 (bright cyan/teal).
// Run: node scripts/derive-palette.mjs

const ANCHOR = "#55D6D0";

// ── color space helpers ───────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const c = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hsl(h, s, l) {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

// ── WCAG contrast ─────────────────────────────────────────────────────────────

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const ch = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── derive palette ────────────────────────────────────────────────────────────

const { h: H } = rgbToHsl(...Object.values(hexToRgb(ANCHOR)));
// Anchor hue for cyan/teal is ~177°. We'll keep a cool-leaning neutral family,
// and pick a warm accent at H≈40 (amber) to prevent "generic cool tech" feel.

const WARM_H = 40;   // amber
const NEUTRAL_H = 205; // cool-leaning slate (matches the cyan family)

const palette = {
  // Brand — anchor and derivations
  "brand-primary":        hsl(H, 0.64, 0.59), // = #55D6D0 (the anchor)
  "brand-primary-hover":  hsl(H, 0.64, 0.52),
  "brand-primary-dark":   hsl(H, 0.55, 0.28), // text-capable on white
  "brand-primary-deep":   hsl(H, 0.50, 0.18), // footer/heavy accents
  "brand-primary-100":    hsl(H, 0.60, 0.92), // light tint backgrounds
  "brand-primary-50":     hsl(H, 0.55, 0.96),

  // Warm accent — amber counter-tension
  "accent-warm":          hsl(WARM_H, 0.88, 0.55),
  "accent-warm-hover":    hsl(WARM_H, 0.88, 0.48),
  "accent-warm-dark":     hsl(WARM_H, 0.82, 0.32), // text-capable on surface (AA text)
  "accent-warm-100":      hsl(WARM_H, 0.80, 0.92),

  // Neutrals — cool-tinted to match the cyan family
  "text-primary":         hsl(NEUTRAL_H, 0.32, 0.12),
  "text-secondary":       hsl(NEUTRAL_H, 0.18, 0.38),
  "text-muted":           hsl(NEUTRAL_H, 0.12, 0.55),
  "text-inverse":         "#ffffff",
  "surface":              hsl(48, 0.30, 0.985), // warm cream — balances the cool cyan accent
  "surface-muted":        hsl(48, 0.25, 0.96),
  "surface-elevated":     "#ffffff",
  "border":               hsl(NEUTRAL_H, 0.15, 0.90),
  "border-strong":        hsl(NEUTRAL_H, 0.12, 0.68),

  // Status
  "status-success":       hsl(145, 0.55, 0.32),
  "status-success-bg":    hsl(145, 0.50, 0.95),
  "status-warning":       hsl(38,  0.85, 0.32),
  "status-warning-bg":    hsl(38,  0.80, 0.94),
  "status-error":         hsl(358, 0.68, 0.44),
  "status-error-bg":      hsl(358, 0.70, 0.96),
  "status-info":          hsl(210, 0.68, 0.40),
  "status-info-bg":       hsl(210, 0.70, 0.96),
};

// ── report ────────────────────────────────────────────────────────────────────

const SURFACE = palette["surface"];
const rows = Object.entries(palette).map(([name, hex]) => {
  const onSurface = contrast(hex, SURFACE);
  const onPrimary = contrast(hex, palette["brand-primary"]);
  const onPrimaryDeep = contrast(hex, palette["brand-primary-deep"]);
  return { name, hex, onSurface, onPrimary, onPrimaryDeep };
});

const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
const fmt = (n) => n.toFixed(2).padStart(5);

console.log("Anchor:", ANCHOR, "→ hue =", H.toFixed(1), "°");
console.log();
console.log(pad("token", 24), pad("hex", 9), "  on-surface  on-primary  on-deep    AA-text?  AA-large/UI?");
console.log("─".repeat(92));
for (const r of rows) {
  const aaText  = r.onSurface >= 4.5 ? "yes" : "no ";
  const aaLarge = r.onSurface >= 3   ? "yes" : "no ";
  console.log(
    pad(r.name, 24),
    pad(r.hex, 9),
    "  " + fmt(r.onSurface),
    "     " + fmt(r.onPrimary),
    "     " + fmt(r.onPrimaryDeep),
    "    " + aaText,
    "       " + aaLarge,
  );
}

console.log();
console.log("Key pairings to sanity-check:");
const pairs = [
  ["text-primary", "surface"],
  ["text-secondary", "surface"],
  ["text-inverse", "brand-primary"],
  ["text-primary", "brand-primary"],
  ["text-inverse", "brand-primary-dark"],
  ["text-inverse", "brand-primary-deep"],
  ["text-inverse", "accent-warm"],
  ["text-primary", "accent-warm"],
  ["text-inverse", "accent-warm-dark"],
  ["brand-primary-dark", "surface"],
  ["accent-warm-dark", "surface"],
  ["status-success", "surface"],
  ["status-error", "surface"],
];
for (const [fg, bg] of pairs) {
  const c = contrast(palette[fg], palette[bg]);
  const verdict = c >= 4.5 ? "AA text" : c >= 3 ? "AA large/UI only" : "FAILS";
  console.log(`  ${pad(fg, 22)} on ${pad(bg, 22)}  ${fmt(c)}  (${verdict})`);
}

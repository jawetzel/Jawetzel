# Embroidery pipeline — deferred improvements

#4 (bilateral smoothing) and #9 (NL-Means denoising) shipped together for the
photo branch. #5 (connected-component analysis) and #SUBTEXT (small-text
halo bleed-back) shipped together since both want CCA. Only #8 remains.

## #8 — Contrast normalization / CLAHE for low-contrast inputs

Washed-out photos quantize poorly — all colors cluster in a narrow band, so
the AI palette can't separate them and quantization creates muddy splits.
`cv2.createCLAHE()` before quantization spreads the histogram and gives
quantization more separation to work with. OpenCV is already a dep (from
#4/#9), so the cost is a few dozen lines with no image-size change.

- **Scope:** `vector_source=False` branch only. Clean graphics already have
  full-range histograms — CLAHE on them is destructive (clips intentional
  white/black levels).
- **Gate:** Measure histogram span; only apply if span < some threshold.
- **Trigger to revisit:** A washed-out photo input produces obviously muddy
  output where the underlying subject is visually distinct in the source.

import asyncio
import io
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from PIL import Image, ImageChops, ImageDraw, ImageFilter

# Per-process "is a real job already running" semaphore. With WORKERS=N uvicorn
# processes each owning one of these, total concurrent jobs across the service
# cap at N. We rolled our own instead of uvicorn --limit-concurrency because
# that flag counts connections at the HTTP layer (including idle keepalives
# from platform health-checks), producing spurious 503s on idle workers.
_JOB_SLOT = asyncio.Semaphore(1)


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


# --- Perceptual color helpers (CIE Lab, D65) ---
# All palette-domain comparisons (gap detection, nearest-kept remap) use Lab
# instead of raw RGB Euclidean. RGB distance treats (dark blue → black) and
# (dark brown → black) as similar when they're visually distinct; Lab matches
# perception. PIL's quantize() itself still uses RGB internally — we can't
# change that — so this only affects OUR comparisons (worker remap + outline
# threshold derivation).

def _srgb_decode(c: float) -> float:
    """sRGB transfer function: gamma-encoded byte (0..1 normalized) -> linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _srgb_encode(c: float) -> float:
    """linear (0..1) -> sRGB gamma-encoded (0..1)."""
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1.0 / 2.4)) - 0.055


_LAB_DELTA = 6.0 / 29.0
_LAB_WHITE_D65 = (0.95047, 1.00000, 1.08883)


def _xyz_to_lab_f(t: float) -> float:
    return t ** (1.0 / 3.0) if t > _LAB_DELTA ** 3 else t / (3 * _LAB_DELTA * _LAB_DELTA) + 4.0 / 29.0


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int] | None:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return None
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _srgb_to_lab(r: int, g: int, b: int) -> tuple[float, float, float]:
    """sRGB byte triplet -> CIE Lab (D65). L ∈ [0,100], a/b roughly [-128,127]."""
    rl = _srgb_decode(r / 255.0)
    gl = _srgb_decode(g / 255.0)
    bl = _srgb_decode(b / 255.0)
    x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
    fx = _xyz_to_lab_f(x / _LAB_WHITE_D65[0])
    fy = _xyz_to_lab_f(y / _LAB_WHITE_D65[1])
    fz = _xyz_to_lab_f(z / _LAB_WHITE_D65[2])
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _lab_distance_sq(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    """Squared Euclidean distance in Lab (≈ ΔE76²). Sufficient for nearest-of-set
    lookups; full ΔE2000 would be more accurate but rarely matters at our scale."""
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def _lstar_to_luma_byte(L_star: float) -> int:
    """Convert L* (0..100 perceptual) back to a Rec.709-ish luma byte (0..255).
    Per-pixel mask thresholding still uses PIL's convert("L") (fast, in C); we
    derive its threshold from a palette-derived L* so the gap math stays
    perceptual while the pixel comparison stays cheap."""
    fy = (L_star + 16) / 116
    Y = fy ** 3 if fy > _LAB_DELTA else 3 * _LAB_DELTA * _LAB_DELTA * (fy - 4.0 / 29.0)
    return max(0, min(255, round(_srgb_encode(max(0.0, min(1.0, Y))) * 255)))


def _luma(hex_color: str) -> float:
    """Perceptual L* (0..100). Replaces Rec.601 luma for palette-domain
    comparisons — perceptually-uniform, so "two dark colors close in L*" matches
    visual judgment of "they look similarly dark"."""
    rgb = _hex_to_rgb(hex_color)
    if rgb is None:
        return 50.0
    L, _, _ = _srgb_to_lab(*rgb)
    return L


def _palette_dark_extremes(palette: list[str] | None) -> tuple[float, float] | None:
    """Return (darkest_lstar, second_darkest_lstar) for the AI palette, or None
    if the palette has fewer than 2 valid colors. The gap between these (in L*
    units) governs whether outline extraction can safely separate outline
    pixels from body pixels — small gap = adjacent dark colors that would get
    fused into a single dark blob if extracted together."""
    if not palette:
        return None
    lstars = sorted(_luma(c) for c in palette)
    if len(lstars) < 2:
        return None
    return (lstars[0], lstars[1])


def _resize_to_target(img: Image.Image, target: tuple[int, int]) -> Image.Image:
    """Resize to fit within target dimensions, preserving aspect ratio. Unlike
    PIL's thumbnail(), this scales UP as well as DOWN — small inputs get
    upsampled to give potrace a finer grid for smoother curve fits. Upsampling
    doesn't add information, but a 400×400 input at a 4×4"/500dpi target (2000
    px) would otherwise be traced at 25× less detail than the rest of the
    pipeline expects. LANCZOS handles both directions cleanly."""
    src_w, src_h = img.size
    tgt_w, tgt_h = target
    if src_w <= 0 or src_h <= 0:
        return img
    scale = min(tgt_w / src_w, tgt_h / src_h)
    new_w = max(1, round(src_w * scale))
    new_h = max(1, round(src_h * scale))
    if (new_w, new_h) == (src_w, src_h):
        return img
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def _odd_kernel_for_mm(px_per_mm: float, target_mm: float, minimum: int = 3) -> int:
    """Convert a physical kernel size (mm) to an odd pixel kernel suitable for
    PIL's morphological filters. Minimum keeps the operation meaningful at low
    DPI where target_mm rounds to <3 px."""
    raw = max(minimum, round(px_per_mm * target_mm))
    return raw if raw % 2 == 1 else raw + 1


# Halo detection shared between /sample-colors (excludes halos from cluster
# statistics) and /trace (inpaints halos from their subject neighbors before
# quantize). Parameters live here so both sites stay in sync.
HALO_GRAD_THRESHOLD = 30.0  # Sobel magnitude over CV2 uint8 Lab. Catches
                            # color-to-color steps.
HALO_WIDTH_KERNEL = 5       # Opening kernel size. Any gradient band ≥5 px
                            # wide is treated as real shading and kept;
                            # bands ≤4 px are anti-alias halos.


def _detect_halo_mask(rgb_arr: np.ndarray) -> np.ndarray:
    """Return a uint8 mask (1 = halo pixel, 0 = non-halo) for an HxWx3 RGB
    uint8 array. A halo is a narrow (≤4 px) band of high Lab-gradient pixels
    sitting between two distinct colors — typical anti-alias ring around
    text, outlines, and sharp color boundaries. Wider gradient regions
    (watercolor shading, brush strokes) survive as real design colors.
    """
    lab = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2LAB).astype(np.float32)
    gx = cv2.Sobel(lab, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lab, cv2.CV_32F, 0, 1, ksize=3)
    gmag = np.sqrt(np.sum(gx * gx + gy * gy, axis=-1))
    edge_mask = (gmag > HALO_GRAD_THRESHOLD).astype(np.uint8)
    open_kernel = np.ones((HALO_WIDTH_KERNEL, HALO_WIDTH_KERNEL), dtype=np.uint8)
    wide_edges = cv2.morphologyEx(edge_mask, cv2.MORPH_OPEN, open_kernel)
    return ((edge_mask.astype(bool)) & (~wide_edges.astype(bool))).astype(np.uint8)


def _is_vector_source_alpha(alpha: Image.Image) -> bool:
    """Bimodal alpha (mostly 0 or 255, very few intermediates) is a strong
    signal the PNG was rendered from clean vector source. Vector inputs have
    crisp shape boundaries with anti-alias only at the edges — we can crank
    smoothing aggression without erasing real detail."""
    hist = alpha.histogram()
    if len(hist) < 256:
        return False
    extremes = hist[0] + hist[255]
    midtones = sum(hist[16:240])
    total = sum(hist) or 1
    return (
        extremes / total > VECTOR_LIKELY_EXTREME_FRACTION
        and midtones / total < VECTOR_LIKELY_MIDTONE_FRACTION
    )


_BUCKET_MERGE_DE_MAX = 12.0   # Lab ΔE threshold for merging palette buckets.
                              # Perceptually-indistinguishable buckets (typical
                              # with median-cut: 4 near-whites each claiming a
                              # different 1-px band of anti-alias halo around
                              # leaves, ΔE 0-7) still collapse cleanly at this
                              # threshold, while mildly-close distinct design
                              # colors (e.g. sage ↔ pink at ΔE ~15) stay apart.
                              # Was 18; lowered to preserve small saturated
                              # features that happen to sit near another
                              # palette choice in perceptual space.
_BUCKET_MERGE_PROTECT_FRAC = 0.05  # Don't merge a pair where BOTH buckets exceed
                                   # this coverage fraction. Two high-coverage
                                   # buckets are both meaningful design colors —
                                   # merging them would collapse a genuine
                                   # gradient (e.g. mid-green + dark-green both
                                   # at 10%+ coverage, ΔE 15) into a single
                                   # bucket that then claims the midtone
                                   # pixels between them. Low-coverage pairs
                                   # (halos, anti-alias noise) still merge
                                   # freely.
def _merge_close_buckets(
    quantized: Image.Image,
    active_indices: set[int],
    palette_bytes: list[int],
) -> tuple[Image.Image, set[int], int]:
    """Iteratively merge pairs of palette buckets whose Lab ΔE falls below
    _BUCKET_MERGE_DE_MAX. Pixels from the less-covered bucket are remapped into
    the more-covered one (direct array mutation, not Image.point — faster at
    this scale).

    Runs BEFORE constrained-quant so that near-identical shades (e.g. the 4
    off-white buckets median-cut creates when a subject is surrounded by paper
    with anti-alias halos) collapse into one canonical shade. Without this,
    the solid-only per-bucket trace stacks multiple near-whites as separate
    layers, showing visible gaps between dark leaf bodies and their edges.

    AI picks normally sit ΔE ≥ 25 apart so this pass is a no-op for them; it
    fires primarily in the median-cut path (no AI palette).
    """
    if len(active_indices) < 2:
        return quantized, active_indices, 0

    arr = np.array(quantized, dtype=np.uint8)
    hist = list(quantized.histogram())  # mutable copy
    total_pixels = max(1, sum(hist[i] for i in range(min(256, len(hist)))))
    protect_px = int(total_pixels * _BUCKET_MERGE_PROTECT_FRAC)

    lab_cache: dict[int, tuple[float, float, float]] = {
        idx: _srgb_to_lab(*palette_bytes[idx * 3 : idx * 3 + 3])
        for idx in active_indices
    }
    active = set(active_indices)
    merged = 0
    threshold_sq = _BUCKET_MERGE_DE_MAX ** 2

    # Greedy closest-pair merge, iterate until no pair falls below threshold.
    # N active ≤ 20 typically; O(N²) pairs per iteration is trivial.
    while True:
        best_pair: tuple[int, int] | None = None
        best_dist_sq = threshold_sq
        idxs = sorted(active)
        for i, a in enumerate(idxs):
            for b in idxs[i + 1:]:
                # Protect pairs where BOTH buckets are high-coverage design
                # colors — they're structurally meaningful, not halo noise,
                # even if perceptually close.
                if hist[a] >= protect_px and hist[b] >= protect_px:
                    continue
                d_sq = _lab_distance_sq(lab_cache[a], lab_cache[b])
                if d_sq < best_dist_sq:
                    best_dist_sq = d_sq
                    best_pair = (a, b)
        if best_pair is None:
            break
        a, b = best_pair
        keep, drop = (a, b) if hist[a] >= hist[b] else (b, a)
        arr[arr == drop] = keep
        hist[keep] += hist[drop]
        hist[drop] = 0
        active.discard(drop)
        merged += 1
        kr, kg, kb = palette_bytes[keep * 3 : keep * 3 + 3]
        dr, dg, db = palette_bytes[drop * 3 : drop * 3 + 3]
        _log(
            f"trace_png bucket merge #{dr:02x}{dg:02x}{db:02x} -> "
            f"#{kr:02x}{kg:02x}{kb:02x} (Lab dE={best_dist_sq ** 0.5:.1f})"
        )

    out = Image.fromarray(arr, mode="P")
    out.putpalette(palette_bytes)
    return out, active, merged


def _absorb_sub_turdsize_islands(
    quantized: Image.Image,
    kept_indices: set[int],
    palette_bytes: list[int],
    min_area_px: int,
    pad_px: int,
    body_strip_mask: Image.Image | None = None,
) -> tuple[Image.Image, set[int], int]:
    """Remap any per-bucket connected component smaller than min_area_px into
    the dominant neighboring bucket. Eliminates sub-turdsize specks that
    potrace would drop as individual paths — without this pass, the per-bucket
    subtract in the trace loop prevents neighbors from covering those pixels,
    leaving visible dead-space speckles inside large fills.

    Unlike the previous light-into-dark-only CCA, this absorbs in any direction
    (majority-wins) and uses turdsize as the threshold so only pixels potrace
    would drop anyway get consolidated. Legitimate thin features (veins, text
    strokes) have area ≥ turdsize and are untouched.

    body_strip_mask (paper + former-outline pixels) is excluded from the
    majority vote so specks near leaf boundaries don't get remapped to the
    whited-out outline color instead of their true surrounding design color.
    """
    arr = np.array(quantized, dtype=np.uint8)
    kept_array = np.array(sorted(kept_indices), dtype=np.uint8)
    # Subject-pixel mask: True where a pixel is valid to count as a neighbor.
    # False at paper/outline so the vote isn't poisoned by whited-out pixels.
    if body_strip_mask is not None:
        valid_subject = np.array(body_strip_mask, dtype=np.uint8) == 0
    else:
        valid_subject = None
    absorbed = 0

    for idx in sorted(kept_indices):
        mask = (arr == idx).astype(np.uint8)
        if mask.sum() == 0:
            continue
        num, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        if num <= 1:
            continue
        for lbl in range(1, num):
            area = int(stats[lbl, cv2.CC_STAT_AREA])
            if area >= min_area_px:
                continue
            x = int(stats[lbl, cv2.CC_STAT_LEFT])
            y = int(stats[lbl, cv2.CC_STAT_TOP])
            w = int(stats[lbl, cv2.CC_STAT_WIDTH])
            h = int(stats[lbl, cv2.CC_STAT_HEIGHT])
            x0 = max(0, x - pad_px)
            y0 = max(0, y - pad_px)
            x1 = min(arr.shape[1], x + w + pad_px)
            y1 = min(arr.shape[0], y + h + pad_px)
            region_values = arr[y0:y1, x0:x1]
            region_labels = labels[y0:y1, x0:x1]
            neighbor_mask = region_labels != lbl
            if valid_subject is not None:
                neighbor_mask &= valid_subject[y0:y1, x0:x1]
            neighbors = region_values[neighbor_mask]
            if neighbors.size == 0:
                continue
            valid = neighbors[np.isin(neighbors, kept_array)]
            if valid.size == 0:
                continue
            counts = np.bincount(valid.astype(np.int32), minlength=256)
            new_idx = int(counts.argmax())
            if new_idx == idx:
                continue
            # Bbox-restricted remap: only touch the speck's own bbox so we
            # don't scan the full 2000×2000 array per speck (was the main
            # cost when absorbing tens of thousands of specks).
            sub_labels = labels[y:y+h, x:x+w]
            sub_arr = arr[y:y+h, x:x+w]
            sub_arr[sub_labels == lbl] = new_idx
            absorbed += 1

    final_kept = {int(i) for i in np.unique(arr) if int(i) in kept_indices}
    out = Image.fromarray(arr, mode="P")
    out.putpalette(palette_bytes)
    return out, final_kept, absorbed


app = FastAPI()

INKSTITCH_PATH = os.environ.get("INKSTITCH_PATH", "/opt/inkstitch/inkstitch.py")

FORMATS = ["dst", "exp", "jef", "pes", "vp3", "xxx"]
ALLOWED_SIZES = {"4x4", "5x7", "6x10", "8x8"}
DEFAULT_TRACE_COLORS = 12
MIN_TRACE_COLORS = 2
MAX_TRACE_COLORS = 16
EMBROIDERY_DPI = 500   # trace resolution in px-per-inch. 62.5 matches the physical stitch-cell
                       # density but produces splotchy vector output. Higher gives potrace a finer
                       # grid so thin outlines and small features survive cleanly. Ink/Stitch picks
                       # its own stitch density when rasterizing the paths, so this only affects
                       # vector fidelity, not machine stitch count per area. 500 supersamples ~8x
                       # over the stitch-density floor — enough to preserve typical 800–1500 px
                       # vector inputs without downscaling. Per-bucket morphological windows are
                       # specified in mm and scaled to actual px_per_mm so smoothing aggression
                       # stays physically consistent at any resolution.
OUTLINE_LUMA_MAX = 80  # pixels darker than this are pulled out as a dedicated black layer. This
                       # captures both thick contour strokes (main outline) and thin interior
                       # texture lines. The downstream geometry prefilter classifies each traced
                       # black path by width: >0.6mm = fill (solid contour), ≤0.6mm = running stitch
                       # (thin detail line), so a single threshold gives us both layers cleanly.
                       # Also stops dark-stroke pixels from contaminating body color quantization,
                       # so similar body shades merge into one bucket instead of splotchy light/dark.
OUTLINE_MAX_FRACTION = 0.3  # if more than this share of the image is dark, skip outline extraction
                            # (dark-dominant art would otherwise strip its own body)
OUTLINE_LUMA_GAP_MIN = 25   # required L* (perceptual lightness) separation between the darkest
                            # palette color (assumed outline) and the next-darkest body color.
                            # Below this, outline extraction would steal body pixels into the
                            # outline blob — e.g. a filled illustration with dark-green leaves
                            # (L* ~37) and a black outline (L* ~15) has gap 22 < 25, so override
                            # to false. cookjunkie's black (L* 15) vs FluorOrange (L* ~57) has
                            # gap 42, comfortably above the floor — extraction allowed. Threshold
                            # picked to cleanly separate those two regimes; expressed in L* units
                            # (0..100), not Rec.601 luma bytes.
PAPER_CHANNEL_MIN = 240     # all of R,G,B above this = treat as paper; matches the post-quantize filter
                            # so paper pixels collapse into one throwaway bucket instead of stealing many
POTRACE_ALPHAMAX = 0.8      # corner threshold (potrace default 1.0); lower preserves sharper corners
POTRACE_OPTTOLERANCE = 0.2  # curve-fit tolerance (default 0.2); looser = fewer, smoother segments
MIN_TURDSIZE_PX = 2         # floor for resolution-scaled turdsize so we always drop single-pixel specks
MODE_FILTER_MM = 0.3        # per-pixel mode over an NxN neighborhood ≈ this physical width.
                            # Absorbs sub-window specks while preserving design features wider than
                            # the window. Tuned to catch typical 2-3 px anti-alias halos at 500 DPI
                            # while leaving thin text strokes (3-5 px @ 500 DPI / 4x4) intact —
                            # subtext should be PRESENT in the output even when too small to read.
MODE_FILTER_VECTOR_MM = 0.15 # vector-rendered PNGs already have crisp edges (bimodal alpha is the
                             # signal) so they don't need aggressive smoothing — the floor
                             # (3 px @ minimum) is enough to absorb
                             # 1-2 px speckle while preserving subtext core pixels (3-5 px strokes
                             # would otherwise be color-shifted toward background majority by a
                             # bigger kernel, e.g. dark-green text re-colored cream).
MASK_DILATE_SIZE = 3        # per-bucket mask dilation (NxN MaxFilter). Grows each color by 1 px so
                            # adjacent buckets overlap and the potrace-smoothed boundaries can't
                            # leave transparent slivers between neighboring fills or against the
                            # outline layer. Stays in pixels (not mm) because potrace's smoothing
                            # tolerance is also pixel-based, so the required overlap is
                            # DPI-independent — 1 px of overlap is enough at any resolution.
VECTOR_LIKELY_EXTREME_FRACTION = 0.95  # ≥95% of alpha pixels at the extremes (0 or 255)
VECTOR_LIKELY_MIDTONE_FRACTION = 0.03  # ≤3% of alpha pixels in the broad midtone band — together
                                       # these classify an input as vector-rendered (clean shape
                                       # boundaries, anti-alias only at edges) vs photo/scan.


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/sample-colors")
async def sample_colors(request: Request):
    """Return the input PNG's top-N dominant SUBJECT clusters so the AI palette
    step can decide how each cluster should route to a thread. Transparent and
    near-white paper excluded from the result set.

    Query params:
      n          — max number of clusters returned (default 20, max 256)
      full_res   — "1" to skip the 200x200 downsample and histogram the full
                   image. Use when the AI needs to see the exact cluster set
                   the trace step will operate on (apples-to-apples routing).
                   Default off keeps the endpoint fast for discovery use.

    Response also includes `total_distinct_colors` — count of unique RGB
    triplets before any quantize — so the caller can see how much the image
    compresses at a given N."""
    _log("=== /sample-colors received ===")
    png_bytes = await request.body()
    if not png_bytes:
        raise HTTPException(status_code=400, detail="Empty request body")

    try:
        n = max(1, min(256, int(request.query_params.get("n", "20"))))
    except ValueError:
        n = 20
    full_res = request.query_params.get("full_res") in ("1", "true", "yes")

    opened = Image.open(io.BytesIO(png_bytes))
    has_alpha = (
        opened.mode in ("RGBA", "LA")
        or (opened.mode == "P" and "transparency" in opened.info)
    )

    # Downsample to 200x200 unless the caller requested full-res sampling.
    # Full-res mode matches the trace-stage quantizer's input exactly, so the
    # AI's per-cluster routing decisions refer to the same clusters the trace
    # will actually encounter — no drift between sampled palette and traced
    # palette from different median-cut inputs.
    SENTINEL_RGB = (1, 254, 1)
    if has_alpha:
        rgba = opened.convert("RGBA")
        if not full_res:
            rgba.thumbnail((200, 200), Image.Resampling.LANCZOS)
        rgb = Image.new("RGB", rgba.size, SENTINEL_RGB)
        rgb.paste(rgba.convert("RGB"), mask=rgba.split()[-1])
    else:
        rgb = opened.convert("RGB")
        if not full_res:
            rgb.thumbnail((200, 200), Image.Resampling.LANCZOS)

    # Count unique RGB triplets (before any quantize) so the caller sees the
    # real long-tail. np.unique over the flat pixel array is C-speed.
    pixels = np.array(rgb, dtype=np.uint8).reshape(-1, 3)
    total_distinct_colors = int(np.unique(pixels, axis=0).shape[0])

    # Halo detection: anti-alias halo pixels at color boundaries are not
    # real design colors. We paint them with the existing SENTINEL_RGB so
    # median-cut's cluster statistics are driven only by interior pixels;
    # the sentinel bucket is discarded from the response below.
    pixels_2d = np.array(rgb, dtype=np.uint8)
    halo_mask = _detect_halo_mask(pixels_2d)
    halo_pixel_count = int(halo_mask.sum())
    pixels_2d[halo_mask > 0] = SENTINEL_RGB
    rgb = Image.fromarray(pixels_2d, mode="RGB")

    # Quantize to many buckets, then read counts via histogram (C-fast).
    # Cap at 256 (PIL hard limit for palette-mode images).
    bucket_target = min(256, max(n * 4, n))
    quantized = rgb.quantize(colors=bucket_target, method=Image.Quantize.MEDIANCUT)
    palette_bytes = quantized.getpalette() or []
    hist = quantized.histogram()

    items: list[dict] = []
    subject_total = 0
    for idx, count in sorted(enumerate(hist), key=lambda x: -x[1]):
        if count == 0 or idx * 3 + 2 >= len(palette_bytes):
            continue
        r, g, b = palette_bytes[idx * 3 : idx * 3 + 3]
        # Skip the sentinel bucket (alpha-transparent pixels AND halo pixels).
        if (
            abs(r - SENTINEL_RGB[0]) < 5
            and abs(g - SENTINEL_RGB[1]) < 5
            and abs(b - SENTINEL_RGB[2]) < 5
        ):
            continue
        # Skip near-white paper — the trace pipeline strips it anyway, and we
        # don't want the AI wasting a thread choice on background.
        if r > 240 and g > 240 and b > 240:
            continue
        items.append({
            "hex": f"#{r:02x}{g:02x}{b:02x}",
            "rgb": [r, g, b],
            "count": count,
        })
        subject_total += count
        if len(items) >= n:
            break

    for item in items:
        item["fraction"] = (
            round(item["count"] / subject_total, 4) if subject_total > 0 else 0.0
        )

    total_pixels_image = pixels_2d.shape[0] * pixels_2d.shape[1]
    halo_frac = halo_pixel_count / max(1, total_pixels_image)
    _log(
        f"/sample-colors returned {len(items)} clusters over {subject_total} subject pixels "
        f"(full_res={full_res}, total_distinct_colors={total_distinct_colors}, "
        f"halo_pixels={halo_pixel_count}/{total_pixels_image}={halo_frac:.1%})"
    )
    return {
        "colors": items,
        "total_pixels": subject_total,
        "total_distinct_colors": total_distinct_colors,
    }


def _run(cmd: list[str], stdin_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, input=stdin_bytes, capture_output=True, check=False)


def _fail(proc: subprocess.CompletedProcess, prefix: str) -> None:
    stderr_tail = proc.stderr.decode("utf-8", errors="replace")[-4000:]
    raise HTTPException(
        status_code=500,
        detail=f"{prefix} exit {proc.returncode}: {stderr_tail}",
    )


def _target_px_from_size(size: str | None) -> tuple[int, int] | None:
    if not size:
        return None
    try:
        w_s, h_s = size.lower().replace("×", "x").split("x")
        return int(float(w_s) * EMBROIDERY_DPI), int(float(h_s) * EMBROIDERY_DPI)
    except (ValueError, AttributeError):
        return None


def _trace_mask(mask: Image.Image, turdsize_px: int, label: str = "") -> tuple[list[str], str | None]:
    if mask.getextrema()[0] == 255:
        _log(f"  trace_mask[{label}] empty, skipped")
        return [], None
    pbm_buf = io.BytesIO()
    mask.convert("1").save(pbm_buf, format="PPM")
    _log(f"  trace_mask[{label}] potrace start pbm_bytes={pbm_buf.tell()} turdsize={turdsize_px}")
    t0 = time.time()
    proc = _run(
        [
            "potrace", "-s",
            "-t", str(turdsize_px),
            "-a", str(POTRACE_ALPHAMAX),
            "-O", str(POTRACE_OPTTOLERANCE),
            "-o", "-", "-",
        ],
        stdin_bytes=pbm_buf.getvalue(),
    )
    _log(f"  trace_mask[{label}] potrace done rc={proc.returncode} out_bytes={len(proc.stdout)} in {time.time()-t0:.2f}s")
    if proc.returncode != 0:
        return [], None
    svg_text = proc.stdout.decode("utf-8", errors="replace")
    paths = re.findall(r'<path[^>]*d="([^"]+)"', svg_text)
    transforms = re.findall(r'<g[^>]*transform="([^"]+)"', svg_text)
    _log(f"  trace_mask[{label}] parsed {len(paths)} paths")
    return paths, (transforms[0] if transforms else None)


def _hoop_mm_from_size(size: str | None) -> tuple[float, float] | None:
    if not size:
        return None
    try:
        w_s, h_s = size.lower().replace("×", "x").split("x")
        return float(w_s) * 25.4, float(h_s) * 25.4
    except (ValueError, AttributeError):
        return None


def _hoop_inches_from_size(size: str | None) -> tuple[float, float] | None:
    if not size:
        return None
    try:
        w_s, h_s = size.lower().replace("×", "x").split("x")
        return float(w_s), float(h_s)
    except (ValueError, AttributeError):
        return None


def _validate_size(size: str | None) -> str:
    if not size:
        raise HTTPException(status_code=400, detail="Missing required query param: size")
    clean = size.strip().lower().replace("×", "x")
    if clean not in ALLOWED_SIZES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{size}'. Allowed: {', '.join(sorted(ALLOWED_SIZES))}",
        )
    return clean


def _apply_hoop_size(svg_text: str, size: str) -> str:
    """Set or replace width/height on the root <svg> tag so Ink/Stitch uses the
    requested hoop dimensions. viewBox is untouched — path coordinates stay
    valid regardless of the physical size."""
    hoop_in = _hoop_inches_from_size(size)
    if hoop_in is None:
        return svg_text
    w_in, h_in = hoop_in

    m = re.search(r"<svg\b[^>]*>", svg_text)
    if not m:
        return svg_text
    tag = m.group(0)

    def upsert(s: str, attr: str, value: str) -> str:
        pattern = rf'\s{attr}="[^"]*"'
        replacement = f' {attr}="{value}"'
        if re.search(pattern, s):
            return re.sub(pattern, replacement, s, count=1)
        return s[:-1] + replacement + ">"

    new_tag = upsert(tag, "width", f"{w_in}in")
    new_tag = upsert(new_tag, "height", f"{h_in}in")
    return svg_text.replace(tag, new_tag, 1)


def _quantize(img: Image.Image, num_colors: int) -> Image.Image:
    return img.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)


def _palette_image(hex_colors: list[str]) -> Image.Image:
    """Build a 1x1 palette image whose palette is the supplied hex colors.
    Pads to 256 entries (PIL requires this) with a neutral filler."""
    rgbs: list[int] = []
    for hex_color in hex_colors:
        h = hex_color.lstrip("#")
        if len(h) != 6:
            continue
        rgbs.extend(int(h[i : i + 2], 16) for i in (0, 2, 4))
    if not rgbs:
        raise ValueError("empty palette")
    filler = [0] * (768 - len(rgbs))
    palette_bytes = bytes(rgbs + filler)
    pal_img = Image.new("P", (1, 1))
    pal_img.putpalette(palette_bytes)
    return pal_img


def _parse_palette_param(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    cleaned: list[str] = []
    for p in parts:
        h = p.lstrip("#")
        if len(h) == 6 and all(c in "0123456789abcdef" for c in h):
            cleaned.append(f"#{h}")
    return cleaned or None


def _parse_routes_param(raw: str | None, n_clusters: int, n_threads: int) -> list[int] | None:
    """Parse a comma-separated list of thread indices (one per cluster).
    Empty string or "-1" marks a cluster as unrouted — the trace will fall
    back to Lab-ΔE nearest-thread for those entries. Values out of range are
    treated as unrouted too, so a malformed AI response degrades gracefully."""
    if raw is None:
        return None
    parts = raw.split(",")
    if len(parts) != n_clusters:
        return None
    out: list[int] = []
    for p in parts:
        p = p.strip()
        if not p or p == "-1":
            out.append(-1)
            continue
        try:
            idx = int(p)
        except ValueError:
            out.append(-1)
            continue
        out.append(idx if 0 <= idx < n_threads else -1)
    return out


def _border_connected_mask(near_white: Image.Image) -> Image.Image:
    """Return a mask where 255 = near-white pixel connected to the image border.
    Interior near-white regions (cream belly, highlights) stay 0 and survive as body."""
    w, h = near_white.size
    # Flood fill marks connected near-white regions with sentinel 128.
    scratch = near_white.copy()
    seeds: list[tuple[int, int]] = []
    # Border seeds: every near-white pixel along the edge rows/columns.
    for x in range(w):
        if scratch.getpixel((x, 0)) == 255:
            seeds.append((x, 0))
        if scratch.getpixel((x, h - 1)) == 255:
            seeds.append((x, h - 1))
    for y in range(h):
        if scratch.getpixel((0, y)) == 255:
            seeds.append((0, y))
        if scratch.getpixel((w - 1, y)) == 255:
            seeds.append((w - 1, y))
    for sx, sy in seeds:
        # Skip seeds that were already absorbed by an earlier flood.
        if scratch.getpixel((sx, sy)) == 255:
            ImageDraw.floodfill(scratch, (sx, sy), 128)
    return scratch.point(lambda p: 255 if p == 128 else 0, mode="L")


def _layer_svg(paths: list[str], transform: str | None, fill: str) -> list[str]:
    transform_attr = f' transform="{transform}"' if transform else ""
    out = [f'<g fill="{fill}"{transform_attr}>']
    for d in paths:
        out.append(f'<path d="{d}"/>')
    out.append("</g>")
    return out


def _trace_png(
    png_bytes: bytes,
    num_colors: int = DEFAULT_TRACE_COLORS,
    size: str | None = None,
    palette: list[str] | None = None,
    extract_outline_override: bool | None = None,
    clusters: list[str] | None = None,
    routes: list[int] | None = None,
    skip_indices: list[int] | None = None,
) -> bytes:
    _log(
        f"trace_png start bytes={len(png_bytes)} size={size} colors={num_colors} "
        f"palette={palette} extract_outline_override={extract_outline_override} "
        f"clusters={len(clusters) if clusters else 0} routes={len(routes) if routes else 0} "
        f"skip_indices={skip_indices}"
    )
    opened = Image.open(io.BytesIO(png_bytes))
    has_alpha = (
        opened.mode in ("RGBA", "LA")
        or (opened.mode == "P" and "transparency" in opened.info)
    )
    img = opened.convert("RGBA" if has_alpha else "RGB")
    _log(f"trace_png opened {img.size} mode={img.mode} has_alpha={has_alpha}")

    target = _target_px_from_size(size)
    if target is not None:
        before = img.size
        img = _resize_to_target(img, target)
        if img.size != before:
            direction = "up" if img.size[0] > before[0] else "down"
            _log(f"trace_png resized {direction} {before} -> {img.size} target={target}")
        else:
            _log(f"trace_png at-target size={img.size}")

    # Alpha IS the subject mask — honor it. PIL's .convert("RGB") on RGBA
    # composites onto pure BLACK, so transparent pixels become the darkest
    # possible value, which outline extraction then promotes into a full thread
    # layer (= giant dark fill where the background should be). Composite onto
    # white so the rest of the pipeline reads a clean background, and stash a
    # hard background mask to union into paper_mask so alpha=0 pixels can't be
    # stitched even when surrounded by opaque pixels (interior cutouts).
    if has_alpha:
        alpha = img.split()[-1]
        vector_source = _is_vector_source_alpha(alpha)
        composited = Image.new("RGB", img.size, (255, 255, 255))
        composited.paste(img.convert("RGB"), mask=alpha)
        img = composited
        alpha_bg_mask = alpha.point(lambda p: 255 if p < 128 else 0, mode="L")
        _log(
            f"trace_png alpha composited onto white, alpha bound as subject mask, "
            f"vector_source={vector_source}"
        )
    else:
        # Opaque input — trust the uploader. This tool is for art designs, not
        # photos: the artist is expected to supply a clean source (white or
        # transparent background). Flood-fill paper stripping handles white
        # backgrounds; colored photo backgrounds become part of the design.
        alpha_bg_mask = None
        vector_source = False

    width, height = img.size
    total_px = width * height or 1

    hoop_mm = _hoop_mm_from_size(size)
    px_per_mm = (width / hoop_mm[0]) if (hoop_mm and hoop_mm[0] > 0) else (EMBROIDERY_DPI / 25.4)
    # Drop anything under ~0.25 mm² (~97 px at 500 DPI / 4×4). Previous setting
    # (1 mm² = ~388 px, with +50% on vector_source) was eating legitimate fine
    # detail like leaf-vein interior cells and sub-mm subtext, causing visible
    # fill gaps between veins. Any sub-0.25 mm² fragment is below embroidery's
    # practical minimum feature size anyway (a 2 mm satin strand is ~0.1 mm²
    # per stitch, so 0.25 mm² = ~2 stitches — smaller than that is noise).
    turdsize_px = max(MIN_TURDSIZE_PX, round(px_per_mm * px_per_mm / 4))
    _log(f"trace_png px_per_mm={px_per_mm:.3f} turdsize_px={turdsize_px}")

    # Pull the dark outline pixels out before quantization so they don't get
    # absorbed into the dominant body color bucket. The caller (AI palette step)
    # can force this off for photos where dark pixels are tonal shading rather
    # than deliberate contour strokes — extracting them creates hundreds of
    # noise paths and brutally slow inkstitch conversion.
    luma = img.convert("L")
    hist = luma.histogram()
    dark_fraction = sum(hist[:OUTLINE_LUMA_MAX]) / total_px
    if extract_outline_override is not None:
        extract_outline = extract_outline_override
        _log(
            f"trace_png dark_fraction={dark_fraction:.4f} extract_outline={extract_outline} (AI-forced)"
        )
    else:
        extract_outline = 0 < dark_fraction < OUTLINE_MAX_FRACTION
        _log(
            f"trace_png dark_fraction={dark_fraction:.4f} extract_outline={extract_outline} (auto)"
        )

    # Worker safety net: even if AI says yes, refuse to extract when the chosen
    # palette has another dark color too close to the outline color. Otherwise
    # body pixels get stolen into the outline blob (e.g. dark-green leaves
    # disappear into a black mass). Where the gap is wide enough, also pull
    # outline_luma_max in to sit below the second-darkest body color so anti-
    # alias halos at that boundary don't leak either way.
    outline_luma_max = OUTLINE_LUMA_MAX
    luma_extremes = _palette_dark_extremes(palette)
    if extract_outline and luma_extremes is not None:
        darkest_l, second_l = luma_extremes
        gap_l = second_l - darkest_l
        if gap_l < OUTLINE_LUMA_GAP_MIN:
            _log(
                f"trace_png OVERRIDE extract_outline -> False "
                f"(palette L* gap {gap_l:.1f} < {OUTLINE_LUMA_GAP_MIN}; "
                f"darkest={darkest_l:.1f}, second={second_l:.1f})"
            )
            extract_outline = False
        else:
            # Midpoint in perceptual L*, then convert back to Rec.709-ish byte
            # luma so the per-pixel mask threshold (PIL convert("L")) compares
            # apples-to-apples. Cap at OUTLINE_LUMA_MAX so we never raise the
            # default; floor at 20 to keep an absolute "clearly dark" minimum.
            adapted_l = (darkest_l + second_l) / 2
            adapted_byte = max(20, _lstar_to_luma_byte(adapted_l))
            outline_luma_max = min(OUTLINE_LUMA_MAX, adapted_byte)
            if outline_luma_max != OUTLINE_LUMA_MAX:
                _log(
                    f"trace_png outline_luma_max -> {outline_luma_max} byte "
                    f"(L* midpoint {adapted_l:.1f}; gap {gap_l:.1f}; "
                    f"darkest={darkest_l:.1f}, second={second_l:.1f})"
                )

    if extract_outline:
        outline_mask = luma.point(
            lambda p: 0 if p < outline_luma_max else 255, mode="L"
        )
        dark_mask = luma.point(
            lambda p: 255 if p < outline_luma_max else 0, mode="L"
        )
        body_img = Image.composite(
            Image.new("RGB", img.size, (255, 255, 255)),
            img,
            dark_mask,
        )
        _log("trace_png outline extraction applied")
    else:
        outline_mask = None
        body_img = img

    # Strip paper pixels (real background) BUT keep near-white regions that are
    # actually interior to the subject (cream belly, eye whites). Flood-fill from
    # the border — only white connected to the border is paper; isolated interior
    # whites stay inside their quantized bucket and get traced as real thread.
    # Use the ORIGINAL image (not body_img) so dark outline pixels read as
    # non-white and form an impenetrable wall to the flood — otherwise paper
    # leaks through former-outline pixels and steals chunks of the outline trace.
    r_chan, g_chan, b_chan = img.split()
    hi = lambda c: c.point(lambda p: 255 if p > PAPER_CHANNEL_MIN else 0, mode="L")
    near_white = ImageChops.multiply(ImageChops.multiply(hi(r_chan), hi(g_chan)), hi(b_chan))
    paper_mask = _border_connected_mask(near_white)
    if alpha_bg_mask is not None:
        # User-authored alpha is authoritative. Every alpha=0 pixel is a
        # deliberate hole — including interior cutouts that the border-flood
        # can't reach.
        paper_mask = ImageChops.lighter(paper_mask, alpha_bg_mask)
    # body_strip_mask = paper plus former-outline. Subtracted from every body
    # color bucket so no body color (including white) stitches where the outline
    # used to be — the outline layer covers that itself. Paper-only mask is kept
    # for the outline's own subtraction so we don't erase the outline from its
    # own trace.
    body_strip_mask = paper_mask
    if extract_outline:
        body_strip_mask = ImageChops.lighter(paper_mask, dark_mask)
    has_paper = paper_mask.getextrema()[1] == 255
    _log(f"trace_png has_paper={has_paper}")
    if has_paper:
        body_img = Image.composite(
            Image.new("RGB", body_img.size, (255, 255, 255)),
            body_img,
            paper_mask,
        )

    # Inpaint anti-alias halo pixels with their nearest subject-color
    # neighbor's value BEFORE quantize. Without this pass, halos between
    # a colored region and paper get RGB-nearest-mapped toward whichever
    # side is closer in RGB — which for a 50/50 halo pixel (e.g. green +
    # white anti-alias ring around text) is a coin flip. The result is a
    # visible thin ring of paper-cluster pixels between the letter and
    # the background ("AAWWAAGG" pattern when zoomed: letter, unstitched
    # gap, paper). Inpainting from subject pixels only (halo AND paper
    # treated as holes in the cv2.inpaint call) pulls each halo into its
    # dominant subject neighbor, so the letter's halo ring gets the
    # letter's color, quantizes to the letter's cluster, and stitches
    # with the letter's thread — clean boundary, no gap.
    body_arr = np.array(body_img, dtype=np.uint8)
    trace_halo_mask = _detect_halo_mask(body_arr)
    trace_halo_count = int(trace_halo_mask.sum())
    if trace_halo_count > 0:
        paper_arr01 = (np.array(paper_mask, dtype=np.uint8) > 0).astype(np.uint8)
        # Holes for cv2.inpaint: halos + paper. Only subject pixels feed the
        # fill. We copy the inpainted result back only at halo positions,
        # leaving paper pixels as their original value (white) — paper stays
        # paper, halos take on subject color.
        union_hole = ((trace_halo_mask > 0) | (paper_arr01 > 0)).astype(np.uint8) * 255
        inpainted = cv2.inpaint(body_arr, union_hole, 3, cv2.INPAINT_TELEA)
        body_arr_new = body_arr.copy()
        body_arr_new[trace_halo_mask > 0] = inpainted[trace_halo_mask > 0]
        body_img = Image.fromarray(body_arr_new, mode="RGB")
        _log(f"trace_png inpainted {trace_halo_count} halo pixels from subject neighbors")

    _log("trace_png quantize start")
    t0 = time.time()
    # Capture the AI palette length BEFORE reassigning the local `palette` to
    # the quantize palette bytes — needed so the constrained-quantization step
    # below can recognize PIL filler indices (anything >= ai_palette_count).
    ai_palette_count = len(palette) if palette else 0
    use_cluster_routing = (
        palette is not None
        and clusters is not None
        and routes is not None
        and len(routes) == len(clusters)
        and len(clusters) > 0
    )
    if use_cluster_routing:
        # Apples-to-apples routing path: quantize to the SAME 256-cluster set
        # the AI saw in /sample-colors, then remap each cluster pixel to the
        # thread index the AI picked for that cluster. Clusters the AI skipped
        # or routed to an invalid thread fall back to Lab-ΔE nearest thread —
        # a loose safety net so a partial AI response still produces a clean
        # trace (vs. rejecting the whole request).
        cluster_pal_img = _palette_image(clusters)
        quantized_clusters = body_img.quantize(palette=cluster_pal_img, dither=Image.Dither.NONE)
        # Build a 256-entry LUT: cluster_idx -> thread_idx.
        # PIL pads cluster palettes to 256 with filler; any filler index maps
        # to thread 0 (the first palette entry, typically the body color).
        thread_lab = [_srgb_to_lab(*_hex_to_rgb(h) or (0, 0, 0)) for h in palette]
        lut = np.zeros(256, dtype=np.uint8)
        ai_routed = 0
        fallback_routed = 0
        for i, cluster_hex in enumerate(clusters):
            thread_idx = routes[i] if i < len(routes) else -1
            if thread_idx >= 0:
                lut[i] = thread_idx
                ai_routed += 1
            else:
                # Fallback: nearest thread by Lab ΔE.
                c_rgb = _hex_to_rgb(cluster_hex) or (0, 0, 0)
                c_lab = _srgb_to_lab(*c_rgb)
                best = min(range(len(palette)), key=lambda j: _lab_distance_sq(c_lab, thread_lab[j]))
                lut[i] = best
                fallback_routed += 1
        cluster_arr = np.array(quantized_clusters, dtype=np.uint8)
        remapped_arr = lut[cluster_arr]
        quantized = Image.fromarray(remapped_arr, mode="P")
        # Repalette the remapped image with the THREAD palette so downstream
        # code reads correct RGB values via getpalette().
        thread_pal_img = _palette_image(palette)
        quantized.putpalette(thread_pal_img.getpalette() or [])
        _log(
            f"trace_png quantize done in {time.time()-t0:.2f}s "
            f"(AI-routed clusters: {ai_routed} routed by AI, {fallback_routed} by ΔE fallback, "
            f"{len(palette)} threads)"
        )
    elif palette:
        pal_img = _palette_image(palette)
        quantized = body_img.quantize(palette=pal_img, dither=Image.Dither.NONE)
        _log(f"trace_png quantize done in {time.time()-t0:.2f}s (AI palette, {ai_palette_count} colors)")
    else:
        # Over-quantize when no AI palette is supplied — we'll consolidate
        # perceptually-identical buckets in the merge pass. Starting with more
        # buckets means gradient-heavy inputs get meaningful INTERMEDIATE
        # shades (e.g. a gradient from light-green → mid-green → dark-green
        # survives as 3 distinct buckets). Without this, median-cut at the
        # default 12 colors would pick only 2 greens and every gradient pixel
        # between them would collapse to the darker one — creating "splotches"
        # where dark regions absorb their rightful lighter neighbors.
        median_cut_colors = max(num_colors, 20)
        quantized = _quantize(body_img, median_cut_colors)
        _log(
            f"trace_png quantize done in {time.time()-t0:.2f}s "
            f"(MEDIANCUT, {median_cut_colors} colors, will be merged)"
        )

    # Honor the AI's "background" role designation: any thread marked as
    # background shouldn't be stitched at all — its pixels are fabric, not
    # a design color. Union those pixels into paper_mask so the downstream
    # body_strip subtract excludes them from every trace layer. Without
    # this, halo/paper-texture pixels that RGB-closest onto a background
    # thread get stitched in that thread's color, showing up as visible
    # white specks in corners and rings around letters.
    if skip_indices and ai_palette_count > 0:
        q_arr = np.array(quantized, dtype=np.uint8)
        skip_px_mask = np.zeros(q_arr.shape, dtype=np.uint8)
        for s in skip_indices:
            if 0 <= s < ai_palette_count:
                skip_px_mask[q_arr == s] = 255
        skip_count = int((skip_px_mask > 0).sum())
        if skip_count > 0:
            skip_mask_img = Image.fromarray(skip_px_mask, mode="L")
            paper_mask = ImageChops.lighter(paper_mask, skip_mask_img)
            body_strip_mask = ImageChops.lighter(paper_mask, dark_mask) if extract_outline else paper_mask
            has_paper = paper_mask.getextrema()[1] == 255
            _log(
                f"trace_png honored background role: {skip_count} pixels "
                f"(from threads {skip_indices}) merged into paper_mask"
            )

    # Absorb single-pixel and sub-speck noise into the dominant adjacent color
    # BEFORE tracing so there are no holes to patch. Each pixel becomes the
    # most common palette index in its NxN neighborhood — genuine edges stay
    # sharp (interior pixels already match their neighbors), specks dissolve.
    # Vector-rendered inputs use a smaller kernel to preserve thin features.
    mode_target_mm = MODE_FILTER_VECTOR_MM if vector_source else MODE_FILTER_MM
    mode_size = _odd_kernel_for_mm(px_per_mm, mode_target_mm)
    quantized = quantized.filter(ImageFilter.ModeFilter(size=mode_size))
    _log(
        f"trace_png mode_filter_size={mode_size} ({mode_target_mm}mm) "
        f"vector_source={vector_source}"
    )
    palette = quantized.getpalette() or []

    # Merge perceptually-indistinguishable buckets. Fires primarily when no AI
    # palette was supplied (median-cut picks N near-identical shades to
    # partition anti-alias halo bands); AI picks are already ΔE ≥ 25 apart.
    pre_merge_hist = quantized.histogram()
    pre_merge_active = {
        i
        for i in range(min(256, len(pre_merge_hist)))
        if pre_merge_hist[i] > 0
        and i * 3 + 2 < len(palette)
        and (ai_palette_count == 0 or i < ai_palette_count)
    }
    if len(pre_merge_active) > 1:
        quantized, _, merged_buckets = _merge_close_buckets(
            quantized, pre_merge_active, palette
        )
        if merged_buckets:
            _log(f"trace_png merged {merged_buckets} close buckets (Lab dE < {_BUCKET_MERGE_DE_MAX})")

    # Constrained quantization: drop palette buckets that are either PIL filler
    # (indices beyond the AI palette length) OR claim fewer than COVERAGE_FLOOR
    # of the mode-filtered subject pixels. Two failure modes this guards:
    #   1. PIL pads supplied palettes to 256 entries with neutral filler black
    #      (0,0,0). Dark anti-alias pixels (deep shadow edges) end up RGB-closer
    #      to (0,0,0) than to any AI thread and get assigned to a filler index,
    #      producing a phantom #000000 layer in the trace. Filler indices are
    #      ALWAYS dropped regardless of coverage — they aren't real AI picks.
    #   2. When the AI picks threads that overlap in RGB space (e.g. Brown +
    #      Evergreen both within ~50 RGB-distance of dark-green leaf pixels),
    #      quantize spreads a single design region across multiple buckets,
    #      fragmenting the trace. Low-coverage buckets are dropped and their
    #      pixels remap into the nearest kept bucket to consolidate splits.
    COVERAGE_FLOOR = 0.005  # 0.5% of subject pixels — anything below is noise
                            # or a mis-picked thread that's stealing fragments.
    hist = quantized.histogram()
    subject_pixels = sum(hist[i] for i in range(min(256, len(hist))))
    coverage_floor_px = max(1, int(subject_pixels * COVERAGE_FLOOR))
    kept_indices: set[int] = set()
    dropped_indices: list[int] = []
    for idx in range(min(256, len(hist))):
        if hist[idx] == 0:
            continue
        if idx * 3 + 2 >= len(palette):
            continue
        is_filler = ai_palette_count > 0 and idx >= ai_palette_count
        if is_filler or hist[idx] < coverage_floor_px:
            dropped_indices.append(idx)
        else:
            kept_indices.add(idx)

    if dropped_indices and kept_indices:
        # Remap each dropped index to the perceptually-nearest kept index using
        # CIE Lab ΔE — RGB Euclidean would treat e.g. dark blue and dark brown
        # as similarly close to filler-black even though they look entirely
        # different. Lab matches human color judgment.
        kept_rgb = {
            idx: tuple(palette[idx * 3 : idx * 3 + 3]) for idx in kept_indices
        }
        kept_lab = {idx: _srgb_to_lab(*rgb) for idx, rgb in kept_rgb.items()}
        lookup = list(range(256))
        for d_idx in dropped_indices:
            d_rgb = tuple(palette[d_idx * 3 : d_idx * 3 + 3])
            d_lab = _srgb_to_lab(*d_rgb)
            nearest_idx = min(
                kept_lab.items(),
                key=lambda kv: _lab_distance_sq(d_lab, kv[1]),
            )[0]
            lookup[d_idx] = nearest_idx
            r, g, b = d_rgb
            kr, kg, kb = kept_rgb[nearest_idx]
            reason = "filler" if (ai_palette_count > 0 and d_idx >= ai_palette_count) else "low-coverage"
            _log(
                f"trace_png drop bucket idx={d_idx} #{r:02x}{g:02x}{b:02x} "
                f"({hist[d_idx]} px = {hist[d_idx]/subject_pixels:.3%}, {reason}) "
                f"-> nearest kept #{kr:02x}{kg:02x}{kb:02x} (Lab dE)"
            )
        quantized = quantized.point(lookup)

    used_indices = kept_indices
    # Rip out AI-marked background threads entirely: those pixels are already
    # in paper_mask (unioned above), so the per-bucket subtract would strip
    # them anyway — but dropping the index from used_indices also skips the
    # mask-building and potrace call for the bucket, so no empty layer
    # appears in the SVG.
    if skip_indices:
        used_indices = {i for i in used_indices if i not in set(skip_indices)}
    _log(
        f"trace_png mode-filter done, {len(used_indices)} palette buckets kept "
        f"({len(dropped_indices)} dropped under {COVERAGE_FLOOR:.1%} floor"
        f"{', ' + str(len(skip_indices)) + ' ripped out as background' if skip_indices else ''})"
    )

    # Absorb sub-turdsize specks into the dominant neighboring bucket. Without
    # this pass, potrace drops any connected component < turdsize_px (the
    # desired behavior), but the per-bucket trace subtract-neighbors step leaves
    # those dropped pixels as holes with no color covering them. Absorbing them
    # here into the majority neighbor means the speck's pixels get painted with
    # the neighbor's color and no hole remains.
    #
    # pad_px=2 keeps the majority vote very local — a speck inside a leaf gets
    # voted on by its immediate 2-px ring, which is almost always the correct
    # surrounding color. A larger pad leaked the vote across outline barriers
    # into adjacent regions of wrong color (leaf A's dark speck getting
    # remapped to leaf B's tan or to the whited-out outline's white).
    # body_strip_mask excludes paper and former-outline pixels from the vote
    # for the same reason — those are artefactual whites, not real neighbors.
    if used_indices:
        quantized, used_indices, absorbed_specks = _absorb_sub_turdsize_islands(
            quantized, used_indices, palette, turdsize_px, pad_px=2,
            body_strip_mask=body_strip_mask,
        )
        if absorbed_specks:
            _log(
                f"trace_png absorbed {absorbed_specks} sub-turdsize specks "
                f"(< {turdsize_px} px, kept buckets now {len(used_indices)})"
            )

    # Pre-compute the union of all kept buckets' pixels, used below to keep
    # each bucket's +1 px dilation from growing into a neighboring bucket's
    # interior (a dark border's dilation would otherwise eat a small bright
    # petal's interior). After the speck-absorb pass above there are no
    # sub-turdsize islands, so this raw-membership subtract is safe.
    union_kept_mask = Image.new("L", quantized.size, 0)
    for _k in used_indices:
        k_mask = quantized.point(lambda p, kk=_k: 255 if p == kk else 0, mode="L")
        union_kept_mask = ImageChops.lighter(union_kept_mask, k_mask)

    layer_fragments: list[str] = []
    for idx in sorted(used_indices):
        r, g, b = palette[idx * 3 : idx * 3 + 3]

        # Positive mask (bucket pixels = 255) for dilation, then flip for potrace
        # which traces black-on-white. Subtract body_strip_mask (paper + former-
        # outline) so body pixels don't START in those zones — the outline
        # pixels were whited-out before quantize, so their bucket assignment is
        # meaningless and must be excluded here.
        positive = quantized.point(lambda p, i=idx: 255 if p == i else 0, mode="L")
        positive = ImageChops.subtract(positive, body_strip_mask)
        dilated = positive.filter(ImageFilter.MaxFilter(size=MASK_DILATE_SIZE))
        # Let body grow +1 px INTO the former-outline area (under the outline
        # layer, which draws last and covers it). Without this underlap, the
        # anti-alias ring between body and outline quantizes to white and leaves
        # a visible gap. Only strip paper so no body color stitches on the
        # background.
        dilated = ImageChops.subtract(dilated, paper_mask)
        # Strip dilated pixels that landed in another kept bucket's territory.
        # Prevents a dark border's +1 px dilation from eating a small bright
        # petal's interior. Safe after the speck-absorb pass because no
        # sub-turdsize islands remain to create holes here.
        other_buckets_mask = ImageChops.subtract(union_kept_mask, positive)
        dilated = ImageChops.subtract(dilated, other_buckets_mask)
        mask = dilated.point(lambda p: 0 if p == 255 else 255, mode="L")
        paths, transform = _trace_mask(mask, turdsize_px, label=f"color[{idx}]#{r:02x}{g:02x}{b:02x}")
        if not paths:
            continue

        fill = f"#{r:02x}{g:02x}{b:02x}"
        layer_fragments.extend(_layer_svg(paths, transform, fill))

    # Outline layer last so it draws on top of the body fills. Dilate so the
    # outline's inner edge overlaps the body fills it borders — no gap can appear.
    # Subtract paper_mask (NOT body_strip_mask — that includes the outline area
    # itself and would erase the outline from its own trace) so the outline just
    # doesn't extend into the background.
    if outline_mask is not None:
        outline_positive = outline_mask.point(lambda p: 255 if p == 0 else 0, mode="L")
        outline_dilated = outline_positive.filter(ImageFilter.MaxFilter(size=MASK_DILATE_SIZE))
        outline_dilated = ImageChops.subtract(outline_dilated, paper_mask)
        outline_for_trace = outline_dilated.point(lambda p: 0 if p == 255 else 255, mode="L")
        paths, transform = _trace_mask(outline_for_trace, turdsize_px, label="outline")
        if paths:
            layer_fragments.extend(_layer_svg(paths, transform, "#000000"))

    # Declare physical dimensions in inches so Ink/Stitch sizes the hoop
    # correctly. viewBox stays in pixel units so path coords remain valid.
    hoop_in = _hoop_inches_from_size(size)
    if hoop_in is not None:
        size_attrs = f'width="{hoop_in[0]}in" height="{hoop_in[1]}in"'
    else:
        size_attrs = f'width="{width}" height="{height}"'
    svg = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" {size_attrs} '
        f'viewBox="0 0 {width} {height}">\n'
        + "\n".join(layer_fragments)
        + "\n</svg>\n"
    )
    _log(f"trace_png done, svg_bytes={len(svg)}")
    return svg.encode("utf-8")


@app.post("/trace")
async def trace(request: Request):
    _log("=== /trace received ===")
    if _JOB_SLOT.locked():
        _log("/trace rejected: slot busy")
        raise HTTPException(status_code=503, detail="Worker slot busy")
    async with _JOB_SLOT:
        return await _trace_handler(request)


async def _trace_handler(request: Request) -> Response:
    png_bytes = await request.body()
    if not png_bytes:
        raise HTTPException(status_code=400, detail="Empty request body")

    size_raw = request.query_params.get("size")
    size = _validate_size(size_raw) if size_raw else None

    colors_raw = request.query_params.get("colors")
    try:
        colors = int(colors_raw) if colors_raw else DEFAULT_TRACE_COLORS
    except ValueError:
        colors = DEFAULT_TRACE_COLORS
    colors = max(MIN_TRACE_COLORS, min(MAX_TRACE_COLORS, colors))

    palette = _parse_palette_param(request.query_params.get("palette"))
    extract_raw = request.query_params.get("extract_outline")
    extract_outline_override: bool | None
    if extract_raw in ("1", "true", "yes"):
        extract_outline_override = True
    elif extract_raw in ("0", "false", "no"):
        extract_outline_override = False
    else:
        extract_outline_override = None

    # AI-routed cluster quantization: clusters[] holds the 256 hex buckets the
    # AI saw in /sample-colors; routes[] (same length) holds the thread index
    # each cluster should map to, or -1 if the AI left it unrouted. Worker
    # falls back to Lab-ΔE nearest-thread for -1 entries, so a partial AI
    # response still works. Both params must be supplied (and palette must
    # exist) for the cluster-routing path to engage.
    clusters = _parse_palette_param(request.query_params.get("clusters"))
    routes: list[int] | None = None
    if clusters is not None and palette is not None:
        routes = _parse_routes_param(
            request.query_params.get("routes"), len(clusters), len(palette)
        )

    # Background-role threads to rip out entirely. Pixels assigned to these
    # palette indices (including the AI's cluster routes that land on them)
    # are treated as unstitched fabric — not clustered, not traced, not
    # painted. Comma-separated indices into `palette`; out-of-range values
    # are dropped.
    skip_indices: list[int] | None = None
    skip_raw = request.query_params.get("skip")
    if skip_raw and palette is not None:
        parsed = []
        for p in skip_raw.split(","):
            p = p.strip()
            if not p:
                continue
            try:
                i = int(p)
            except ValueError:
                continue
            if 0 <= i < len(palette):
                parsed.append(i)
        if parsed:
            skip_indices = parsed

    t0 = time.time()
    svg_bytes = _trace_png(
        png_bytes,
        num_colors=colors,
        size=size,
        palette=palette,
        extract_outline_override=extract_outline_override,
        clusters=clusters,
        routes=routes,
        skip_indices=skip_indices,
    )
    _log(f"=== /trace complete in {time.time()-t0:.2f}s, {len(svg_bytes)} bytes ===")
    return Response(content=svg_bytes, media_type="image/svg+xml")


@app.post("/convert")
async def convert(request: Request):
    _log("=== /convert received ===")
    if _JOB_SLOT.locked():
        _log("/convert rejected: slot busy")
        raise HTTPException(status_code=503, detail="Worker slot busy")
    async with _JOB_SLOT:
        return await _convert_handler(request)


async def _convert_handler(request: Request) -> Response:
    size = _validate_size(request.query_params.get("size"))
    svg_bytes = await request.body()
    if not svg_bytes:
        raise HTTPException(status_code=400, detail="Empty request body")
    _log(f"/convert svg_bytes={len(svg_bytes)} size={size}")

    svg_text = svg_bytes.decode("utf-8", errors="replace")
    svg_text = _apply_hoop_size(svg_text, size)
    svg_bytes = svg_text.encode("utf-8")

    with tempfile.TemporaryDirectory() as tmpdir:
        svg_path = os.path.join(tmpdir, "input.svg")
        png_path = os.path.join(tmpdir, "preview.png")
        with open(svg_path, "wb") as f:
            f.write(svg_bytes)
        _log("/convert inkstitch start")
        t0 = time.time()

        ink_proc = _run([
            "xvfb-run", "-a",
            "python3",
            INKSTITCH_PATH,
            "--extension=zip",
            *[f"--format-{fmt}=true" for fmt in FORMATS],
            svg_path,
        ])
        _log(f"/convert inkstitch done rc={ink_proc.returncode} stdout={len(ink_proc.stdout)} in {time.time()-t0:.2f}s")
        if ink_proc.returncode != 0:
            _fail(ink_proc, "inkstitch")

        _log("/convert inkscape start")
        t0 = time.time()
        png_proc = _run([
            "inkscape",
            "--export-type=png",
            "--export-area-drawing",
            "--export-dpi=96",
            f"--export-filename={png_path}",
            svg_path,
        ])
        _log(f"/convert inkscape done rc={png_proc.returncode} in {time.time()-t0:.2f}s")
        if png_proc.returncode != 0 or not os.path.exists(png_path):
            _fail(png_proc, "inkscape")

        _log("/convert bmp convert")
        with Image.open(png_path) as im:
            bmp_buf = io.BytesIO()
            im.convert("RGB").save(bmp_buf, format="BMP")

        _log("/convert zip assemble")
        final_zip = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(ink_proc.stdout), "r") as src, \
             zipfile.ZipFile(final_zip, "w", zipfile.ZIP_DEFLATED) as dst:
            for item in src.infolist():
                dst.writestr(item, src.read(item.filename))
            dst.writestr("embroidery.bmp", bmp_buf.getvalue())
            dst.writestr("embroidery.svg", svg_bytes)

        _log(f"=== /convert complete, zip_bytes={final_zip.tell()} ===")
        return Response(content=final_zip.getvalue(), media_type="application/zip")

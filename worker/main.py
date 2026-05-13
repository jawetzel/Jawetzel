import asyncio
import io
import math
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


def _hex_to_rgb_or_black(hex_color: str) -> tuple[int, int, int]:
    """Same as _hex_to_rgb but falls back to (0, 0, 0) on malformed input.
    Centralizes the `_hex_to_rgb(h) or (0, 0, 0)` pattern that appears at
    every site building palette arrays."""
    return _hex_to_rgb(hex_color) or (0, 0, 0)


def _hex_list_to_rgb_array(hexes: list[str], dtype=np.uint8) -> np.ndarray:
    """Vectorize a hex list into an (N, 3) numpy array, malformed entries
    coerced to black. Used wherever the pipeline needs to compare a pixel
    array against every thread/cluster color at once."""
    return np.array([_hex_to_rgb_or_black(h) for h in hexes], dtype=dtype)


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


# Color > brightness weighting for cluster→thread routing. Decomposes ΔE into
# (ΔL, ΔC, ΔH) — lightness, chroma magnitude, hue arc — then weights each
# differently. Hue is scaled by the cluster's chroma² so truly grey clusters
# get no hue penalty (their hue is undefined) but chromatic clusters strongly
# prefer threads in the same hue family, even if those threads are farther
# in absolute Lab. Tuned so pale watercolor pinks route to a pink thread
# instead of Lily White, where pure ΔE picks Lily White because the lightness
# gap to a saturated pink thread dominates.
_COLOR_W_L = 0.5  # lightness weight — <1.0 because brightness matters less to the eye
                  # than hue at moderate-to-high lightness, and embroidery thread
                  # selection is fundamentally about matching color identity.
_COLOR_W_C = 0.5  # chroma-magnitude weight — penalizes mismatched saturation but
                  # not as hard as full Lab ΔE would (a faint cluster shouldn't
                  # be punished for not exactly matching a saturated thread).
_COLOR_W_H = 4.0  # hue arc weight — primary signal. With cluster_chroma² as a
                  # multiplier this is what flips pale-pink → Dusty Rose when
                  # plain ΔE would route to Lily White.


def _color_weighted_lab_dist_sq(
    lab_cluster: tuple[float, float, float],
    lab_thread: tuple[float, float, float],
) -> float:
    L1, a1, b1 = lab_cluster
    L2, a2, b2 = lab_thread
    dL = L1 - L2
    C1 = math.sqrt(a1 * a1 + b1 * b1)
    C2 = math.sqrt(a2 * a2 + b2 * b2)
    dC = C1 - C2
    h1 = math.atan2(b1, a1)
    h2 = math.atan2(b2, a2)
    dh = h1 - h2
    if dh > math.pi:
        dh -= 2 * math.pi
    elif dh < -math.pi:
        dh += 2 * math.pi
    return (
        _COLOR_W_L * dL * dL
        + _COLOR_W_C * dC * dC
        + _COLOR_W_H * C1 * C1 * dh * dh
    )


# sRGB→Lab over an entire pixel array, vectorized. Used by the custom
# color-weighted quantizer below. All-float32 to keep memory under control on
# full-target images — at 4000×4000 = 16M pixels even one float64 temporary
# is 384 MB, and the prior float64 version would OOM-kill the worker on
# Docker default memory limits.
_SRGB_TO_XYZ_M = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ],
    dtype=np.float32,
)
_D65_WHITE = np.array([0.95047, 1.00000, 1.08883], dtype=np.float32)
_LAB_DELTA3 = np.float32((6.0 / 29.0) ** 3)
_LAB_F_OFFSET = np.float32(4.0 / 29.0)
_LAB_F_LINEAR_DIV = np.float32(3 * (6.0 / 29.0) ** 2)


def _srgb_to_lab_arr(rgb_arr: np.ndarray) -> np.ndarray:
    norm = rgb_arr.astype(np.float32) / np.float32(255.0)
    # Gamma decode in place where possible — avoids the extra float64 temporary
    # the prior implementation kept around.
    linear = np.where(
        norm <= np.float32(0.04045),
        norm / np.float32(12.92),
        ((norm + np.float32(0.055)) / np.float32(1.055)) ** np.float32(2.4),
    )
    xyz = linear @ _SRGB_TO_XYZ_M.T
    xyz_n = xyz / _D65_WHITE
    f = np.where(
        xyz_n > _LAB_DELTA3,
        np.cbrt(xyz_n),
        xyz_n / _LAB_F_LINEAR_DIV + _LAB_F_OFFSET,
    )
    L = np.float32(116.0) * f[..., 1] - np.float32(16.0)
    a = np.float32(500.0) * (f[..., 0] - f[..., 1])
    b = np.float32(200.0) * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


# Color-weighted quantize. Replaces PIL's RGB-Euclidean quantize(palette=…)
# with a numpy implementation that uses the same (ΔL, ΔC, ΔH) decomposition as
# the cluster→thread routing fallback. Chunked along the pixel axis so the
# per-thread distance tensor stays under a few hundred MB even on full-target
# 4000×4000 images.
def _color_weighted_quantize(body_img: Image.Image, palette: list[str]) -> Image.Image:
    body_arr = np.array(body_img.convert("RGB"), dtype=np.uint8)
    H, W = body_arr.shape[:2]
    pixels_rgb = body_arr.reshape(-1, 3)
    N = pixels_rgb.shape[0]

    pixels_lab = _srgb_to_lab_arr(pixels_rgb)
    L = pixels_lab[:, 0]
    a = pixels_lab[:, 1]
    b = pixels_lab[:, 2]
    chroma_sq = (a * a + b * b).astype(np.float32)
    chroma = np.sqrt(chroma_sq)
    hue = np.arctan2(b, a).astype(np.float32)

    thread_rgb = _hex_list_to_rgb_array(palette, dtype=np.uint8)
    thread_lab = _srgb_to_lab_arr(thread_rgb)
    t_L = thread_lab[:, 0]
    t_C = np.sqrt(thread_lab[:, 1] ** 2 + thread_lab[:, 2] ** 2).astype(np.float32)
    t_h = np.arctan2(thread_lab[:, 2], thread_lab[:, 1]).astype(np.float32)

    out = np.zeros(N, dtype=np.uint8)
    CHUNK = 1_000_000  # ~ N_chunk × T × 4 bytes per per-distance tensor
    pi32 = np.float32(math.pi)
    two_pi32 = np.float32(2 * math.pi)
    for start in range(0, N, CHUNK):
        end = min(start + CHUNK, N)
        dL = (L[start:end, None] - t_L[None, :]).astype(np.float32)
        dC = (chroma[start:end, None] - t_C[None, :]).astype(np.float32)
        dh = hue[start:end, None] - t_h[None, :]
        # Wrap to (-π, π] without np.where (in-place is faster + no temp array)
        dh = np.where(dh > pi32, dh - two_pi32, dh)
        dh = np.where(dh < -pi32, dh + two_pi32, dh)
        dist_sq = (
            np.float32(_COLOR_W_L) * dL * dL
            + np.float32(_COLOR_W_C) * dC * dC
            + np.float32(_COLOR_W_H) * chroma_sq[start:end, None] * dh * dh
        )
        out[start:end] = np.argmin(dist_sq, axis=1).astype(np.uint8)

    indexed = out.reshape(H, W)
    return _to_thread_palette_image(indexed, palette)


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


def _resize_for_sample(
    img: Image.Image,
    target: tuple[int, int] | None,
    full_res: bool,
    size_param: str | None,
) -> Image.Image:
    """Sample-colors resize policy: if a hoop target was supplied, resize to
    match /trace's pixel grid (apples-to-apples cluster set). Otherwise drop
    to a 200×200 thumbnail unless the caller explicitly asked for full_res.
    Logs the resize so the response is debuggable from the worker stream."""
    if target is not None:
        before = img.size
        resized = _resize_to_target(img, target)
        if resized.size != before:
            _log(f"/sample-colors resized {before} -> {resized.size} to match {size_param} target")
        return resized
    if not full_res:
        img.thumbnail((200, 200), Image.Resampling.LANCZOS)
    return img


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


def _chroma_array(rgb_arr: np.ndarray) -> np.ndarray:
    """Per-pixel channel spread (max(R,G,B) − min(R,G,B)) as int16. Used as a
    cheap "is this near-neutral grey?" gate — true paper-white sits near 0,
    pale watercolor tints sit at ~10-15, saturated colors well above. int16
    so the subtraction doesn't wrap uint8."""
    r = rgb_arr[..., 0].astype(np.int16)
    g = rgb_arr[..., 1].astype(np.int16)
    b = rgb_arr[..., 2].astype(np.int16)
    return np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)


def _paper_pixel_mask_np(rgb_arr: np.ndarray) -> np.ndarray:
    """Boolean mask of pixels that pass the paper test: every channel above
    PAPER_CHANNEL_MIN AND chroma ≤ PAPER_MAX_CHROMA. Same rule as the scalar
    /sample-colors check, but vectorized for the trace pipeline. Returns a
    bool array; callers convert to uint8 if they need a PIL-friendly mask."""
    r = rgb_arr[..., 0]
    g = rgb_arr[..., 1]
    b = rgb_arr[..., 2]
    high = (r > PAPER_CHANNEL_MIN) & (g > PAPER_CHANNEL_MIN) & (b > PAPER_CHANNEL_MIN)
    return high & (_chroma_array(rgb_arr) <= PAPER_MAX_CHROMA)


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

    return _to_palette_image(arr, palette_bytes), active, merged


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
    return _to_palette_image(arr, palette_bytes), final_kept, absorbed


# Border-island stray reassignment tuning. A "border" is any kept-bucket CC
# whose outer contour encloses a clearly-dominant interior bucket. "Strays"
# are pixels of any OTHER bucket that sit in a small dilation band on the
# inside of that border — typical quantize residue from anti-alias bleed at
# colored boundaries (e.g. a yellow lightning-bolt border with an orange
# band of AA pixels between the border and the white fill).
BORDER_ISLAND_BAND_MM = 0.5         # how far inside the border we'll absorb strays.
                                    # 0.5 mm comfortably covers the typical AA
                                    # band (~2-4 px at 4x4/500dpi) without
                                    # diving into legitimate interior detail.
BORDER_ISLAND_INTERIOR_MIN = 0.90   # required share of the enclosed area that
                                    # must already belong to a single interior
                                    # bucket. 70% let in cases where a frame
                                    # enclosed text on a light background: the
                                    # paper-colored negative space dominated by
                                    # popularity even though letter strokes were
                                    # real design features. 90% demands "nearly
                                    # uniform" so the fix only fires on the
                                    # intended single-fill-with-AA-halo case.
BORDER_ISLAND_MIN_AREA_MM2 = 1.0    # minimum CC area before we even consider
                                    # it a border. Skips speck CCs whose tiny
                                    # enclosure would trivially be 100% one
                                    # color and trigger spurious reassignments.


def _absorb_border_island_strays(
    quantized: Image.Image,
    used_indices: set[int],
    palette_bytes: list[int],
    px_per_mm: float,
    body_strip_mask: Image.Image | None = None,
) -> tuple[Image.Image, int, int]:
    """For each kept-bucket connected component that forms a closed contour
    around another bucket, if a single interior bucket Y dominates the
    enclosed pixels (≥ BORDER_ISLAND_INTERIOR_MIN), reassign any in-between
    pixels in a small dilation band on the inside of the border to Y.

    Pixels in body_strip_mask (paper + former-outline) are excluded from
    both the dominance vote AND the reassignment — they're not real subject
    pixels and we don't want them counted toward "interior" or rewritten as
    something else.

    Returns (updated quantized image, total pixels reassigned, number of
    border CCs that triggered the fix).
    """
    arr = np.array(quantized, dtype=np.uint8)
    H, W = arr.shape

    if body_strip_mask is not None:
        excluded = np.array(body_strip_mask, dtype=np.uint8) > 0
    else:
        excluded = np.zeros((H, W), dtype=bool)

    band_px = _odd_kernel_for_mm(px_per_mm, BORDER_ISLAND_BAND_MM)
    band_kernel = np.ones((band_px, band_px), dtype=np.uint8)
    min_border_area_px = max(4, int(px_per_mm * px_per_mm * BORDER_ISLAND_MIN_AREA_MM2))

    reassigned_total = 0
    border_hits = 0

    # Band-kernel pad: a CC's dilation by `band_px` extends `band_px // 2`
    # pixels beyond its bbox. Pad each crop by that much before dilating so
    # the band is identical to the full-image version, then strip the pad
    # back when intersecting with hole masks.
    band_pad = band_px // 2 + 1
    neighbor_kernel = np.ones((3, 3), dtype=np.uint8)

    for border_idx in sorted(used_indices):
        # `& ~excluded` keeps "paper as accidental border" out: paper-bucket
        # pixels live in body_strip_mask and get filtered here, so the CCA
        # sees only the subject portion of every bucket.
        bucket_mask_arr = ((arr == border_idx) & (~excluded)).astype(np.uint8)
        if int(bucket_mask_arr.sum()) < min_border_area_px:
            continue
        # ConnectedComponentsWithStats returns per-label (x, y, w, h, area)
        # so we can prune small CCs by area-lookup instead of allocating one
        # full-size bool mask per CC just to count its pixels — that loop
        # was burning ~50s at 4000×3695 when bucket counts ran into the
        # hundreds.
        num, labels, stats, _ = cv2.connectedComponentsWithStats(
            bucket_mask_arr, connectivity=8
        )
        if num <= 1:
            continue
        areas = stats[:, cv2.CC_STAT_AREA]
        # Label 0 is background; everything else is a real CC. Pre-filter
        # by area before any per-CC work.
        big_labels = np.where(areas >= min_border_area_px)[0]
        big_labels = big_labels[big_labels > 0]
        if big_labels.size == 0:
            continue
        for lbl in big_labels:
            cc_x = int(stats[lbl, cv2.CC_STAT_LEFT])
            cc_y = int(stats[lbl, cv2.CC_STAT_TOP])
            cc_w = int(stats[lbl, cv2.CC_STAT_WIDTH])
            cc_h = int(stats[lbl, cv2.CC_STAT_HEIGHT])
            cc_area = int(stats[lbl, cv2.CC_STAT_AREA])
            # Pad the crop so the band-kernel dilation behaves identically
            # to the full-image version at the bbox edges. Clamp to image
            # bounds so the slice stays valid.
            x0 = max(0, cc_x - band_pad)
            y0 = max(0, cc_y - band_pad)
            x1 = min(W, cc_x + cc_w + band_pad)
            y1 = min(H, cc_y + cc_h + band_pad)
            crop_labels = labels[y0:y1, x0:x1]
            cc_mask = (crop_labels == lbl).astype(np.uint8)
            # Holes inside the CC's outer contour. RETR_EXTERNAL + FILLED fills
            # the whole shape (border + holes); subtracting the CC itself
            # leaves just the holes.
            contours, _ = cv2.findContours(cc_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not contours:
                continue
            filled = np.zeros_like(cc_mask)
            cv2.drawContours(filled, contours, -1, color=1, thickness=cv2.FILLED)
            all_holes_mask = filled.astype(bool) & ~cc_mask.astype(bool)
            if not all_holes_mask.any():
                continue
            # Split into individual enclosed regions. Each is evaluated for
            # its OWN dominance — a multi-triangle border that encloses
            # several distinct shapes shouldn't blend their stats. Without
            # this, a banner-style border whose enclosure is mostly one
            # color but contains pockets of other colors (text letters)
            # would pass dominance globally and rewrite halo pixels INSIDE
            # those other pockets across their own enclosing borders.
            num_holes, hole_labels, hole_stats, _ = (
                cv2.connectedComponentsWithStats(
                    all_holes_mask.astype(np.uint8), connectivity=4
                )
            )
            if num_holes <= 1:
                continue
            border_neighbors = (
                cv2.dilate(cc_mask, neighbor_kernel, iterations=1).astype(bool)
                & (~cc_mask.astype(bool))
            )
            dilated = cv2.dilate(cc_mask, band_kernel, iterations=1).astype(bool)
            # Crop views into the global arrays — assignments through these
            # views write back to `arr` directly, so per-bucket changes
            # survive into the next outer-loop iteration.
            arr_crop = arr[y0:y1, x0:x1]
            excluded_crop = excluded[y0:y1, x0:x1]
            for hole_lbl in range(1, num_holes):
                # Hole area prune via stats — same bincount idea as the
                # outer loop, just at the hole level.
                if int(hole_stats[hole_lbl, cv2.CC_STAT_AREA]) < 4:
                    continue
                this_hole = hole_labels == hole_lbl
                valid_hole = this_hole & (~excluded_crop)
                if int(valid_hole.sum()) < 4:
                    continue
                hole_values = arr_crop[valid_hole]
                counts = np.bincount(hole_values, minlength=256).astype(np.int64)
                counts[border_idx] = 0  # border itself isn't an interior candidate
                total = int(counts.sum())
                if total == 0:
                    continue
                interior_idx = int(counts.argmax())
                if interior_idx not in used_indices:
                    continue
                interior_share = counts[interior_idx] / total
                if interior_share < BORDER_ISLAND_INTERIOR_MIN:
                    continue
                # Connectivity gate: only buckets whose pixels are immediately
                # adjacent (1 px) to the border CC, INSIDE THIS HOLE, qualify
                # as halo. Stops the flood from jumping across an inner
                # border to reach pixels in a different enclosed region.
                adjacent_vals = arr_crop[border_neighbors & this_hole & (~excluded_crop)]
                if adjacent_vals.size == 0:
                    continue
                adjacent_buckets = set(int(v) for v in np.unique(adjacent_vals))
                adjacent_buckets.discard(border_idx)
                adjacent_buckets.discard(interior_idx)
                if not adjacent_buckets:
                    continue
                # Band restricted to this specific hole — same border CC's
                # dilation, but the part that lies inside THIS enclosure.
                band_inside = dilated & this_hole & (~excluded_crop)
                halo_mask = np.isin(arr_crop, np.array(sorted(adjacent_buckets), dtype=np.uint8))
                stray = band_inside & halo_mask
                stray_count = int(stray.sum())
                if stray_count == 0:
                    continue
                arr_crop[stray] = interior_idx
                reassigned_total += stray_count
                border_hits += 1
                br, bg_, bb = palette_bytes[border_idx * 3 : border_idx * 3 + 3]
                ir, ig, ib = palette_bytes[interior_idx * 3 : interior_idx * 3 + 3]
                halo_hexes = ",".join(
                    f"#{palette_bytes[h*3]:02x}{palette_bytes[h*3+1]:02x}{palette_bytes[h*3+2]:02x}"
                    for h in sorted(adjacent_buckets)
                )
                _log(
                    f"  border_island border=#{br:02x}{bg_:02x}{bb:02x} "
                    f"(cc={cc_area}px) hole={int(this_hole.sum())}px "
                    f"interior=#{ir:02x}{ig:02x}{ib:02x} "
                    f"({interior_share:.1%}) "
                    f"halo_buckets=[{halo_hexes}] "
                    f"reassigned {stray_count}px within {band_px}px band"
                )

    if reassigned_total == 0:
        return quantized, 0, 0
    return _to_palette_image(arr, palette_bytes), reassigned_total, border_hits


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
PAPER_MAX_CHROMA = 8        # max(R,G,B) − min(R,G,B) must be ≤ this for a pixel to be classified as
                            # paper. True paper-white has near-zero chroma; pale watercolor washes
                            # (highlight tints like (252,244,240) with chroma 12) have small but
                            # measurable color. Without this check the border-connected flood-fill
                            # chains through "almost white" tinted regions into interior highlights
                            # and eats them — they end up as fabric instead of being stitched in
                            # the lightest body thread.
PAPER_PIXEL_MAX_CHROMA = 12 # Per-pixel chroma gate on the background-role strip. The cluster-level
                            # chroma threshold above (PAPER_MAX_CHROMA=8) protects /sample-colors,
                            # but at trace time a single cluster averages many pixels — a chest
                            # cluster mostly light-peach but with paper-white edge pixels can
                            # centroid into "near-white" territory and the AI then routes the
                            # whole cluster to the Lily-White-as-background thread. Every pixel
                            # in that cluster, including the visibly chromatic ones, gets stripped.
                            # This per-pixel gate runs AFTER quantization: if a pixel routed to a
                            # background-role thread but its own RGB has chroma above this, re-route
                            # it to the nearest non-background thread. 12 cleanly separates pure
                            # paper (chroma ≈ 0–3) from light peach/tan (chroma ≥ 20) without
                            # accepting JPEG-noisy paper as subject.
POTRACE_ALPHAMAX = 1.0      # corner threshold (potrace default 1.0). Was 0.8 to preserve sharper
                            # corners, but embroidery rounds every transition with thread thickness
                            # anyway — the extra corner fidelity wasn't reproducible on the machine
                            # and was costing us segments. At 1.0 (the default) potrace converts more
                            # boundary transitions to curves instead of corner+line pairs, which
                            # cuts segment count without affecting fill area the way opttolerance can.
POTRACE_OPTTOLERANCE = 0.5  # curve-fit tolerance (default 0.2); looser = fewer, smoother segments.
                            # 0.5 hits a good middle: roughly halves the segment count from default
                            # (50→~25 segments per path), enough to take real time off inkstitch's
                            # per-path math, without smoothing boundaries so aggressively that fill
                            # regions get eaten. 0.7 was visibly too loose — interior colors leaked
                            # because simplified contours cut into the fills they bounded.
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
    # When the caller passes the hoop size we use it as the size cap. This
    # makes /sample-colors process the SAME pixel resolution that /trace's
    # quantize step will see — apples-to-apples cluster set, no drift between
    # sampled palette and traced palette. Crucially it also bounds memory:
    # an 8 MB source PNG at 4500×4900 (~22 M px) would otherwise allocate
    # ~1 GB of Lab + Sobel floats in halo detection and OOM-kill the worker
    # on Docker defaults. Bounded to the 4×4 target (2000²), peak drops by
    # roughly 5×.
    size_param = request.query_params.get("size")
    target_after_resize = _target_px_from_size(size_param) if size_param else None

    opened = Image.open(io.BytesIO(png_bytes))
    has_alpha = (
        opened.mode in ("RGBA", "LA")
        or (opened.mode == "P" and "transparency" in opened.info)
    )

    SENTINEL_RGB = (1, 254, 1)
    if has_alpha:
        rgba = _resize_for_sample(
            opened.convert("RGBA"), target_after_resize, full_res, size_param
        )
        rgb = Image.new("RGB", rgba.size, SENTINEL_RGB)
        rgb.paste(rgba.convert("RGB"), mask=rgba.split()[-1])
    else:
        rgb = _resize_for_sample(
            opened.convert("RGB"), target_after_resize, full_res, size_param
        )

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
        # don't want the AI wasting a thread choice on background. Same
        # high-brightness + low-chroma rule the /trace paper detection uses,
        # so a watercolor highlight tint at (250,242,240) (chroma 10) survives
        # into the cluster set instead of being dropped as paper.
        if r > PAPER_CHANNEL_MIN and g > PAPER_CHANNEL_MIN and b > PAPER_CHANNEL_MIN:
            chroma_here = max(r, g, b) - min(r, g, b)
            if chroma_here <= PAPER_MAX_CHROMA:
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

    # Cluster spread = max pairwise RGB distance among the returned cluster
    # centroids. Range 0..~441 (442 = black vs white). Low spread means the
    # image is monochromatic / low contrast — the trace's background-strip
    # heuristics need to be relaxed for those, because the AI's "background
    # role" assumption (there's a paper-white to strip) doesn't hold.
    cluster_spread = 0
    if len(items) >= 2:
        rgb_arr = np.array([it["rgb"] for it in items], dtype=np.int32)
        diff = rgb_arr[:, None, :] - rgb_arr[None, :, :]
        d2 = (diff * diff).sum(axis=2)
        cluster_spread = int(round(float(np.sqrt(d2.max()))))

    total_pixels_image = pixels_2d.shape[0] * pixels_2d.shape[1]
    halo_frac = halo_pixel_count / max(1, total_pixels_image)
    _log(
        f"/sample-colors returned {len(items)} clusters over {subject_total} subject pixels "
        f"(full_res={full_res}, total_distinct_colors={total_distinct_colors}, "
        f"cluster_spread={cluster_spread}/441, "
        f"halo_pixels={halo_pixel_count}/{total_pixels_image}={halo_frac:.1%})"
    )
    return {
        "colors": items,
        "total_pixels": subject_total,
        "total_distinct_colors": total_distinct_colors,
        "cluster_spread": cluster_spread,
    }


def _run(cmd: list[str], stdin_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, input=stdin_bytes, capture_output=True, check=False)


def _fail(proc: subprocess.CompletedProcess, prefix: str) -> None:
    # Log to the worker stream BEFORE raising so the failure is debuggable from
    # the container logs alone — previously the rc + stderr lived only in the
    # HTTP response body, which made worker-only logs read as a bare
    # "unexpected EOF" with no context.
    stderr_text = proc.stderr.decode("utf-8", errors="replace") if proc.stderr else ""
    stderr_tail = stderr_text[-4000:]
    stdout_bytes = len(proc.stdout or b"")
    stdout_preview = (proc.stdout[:200] if proc.stdout else b"").decode(
        "utf-8", errors="replace"
    )
    _log(f"FAIL {prefix} rc={proc.returncode} stdout_bytes={stdout_bytes}")
    if stdout_preview:
        _log(f"FAIL {prefix} stdout[0:200]={stdout_preview!r}")
    if stderr_tail:
        _log(f"FAIL {prefix} stderr_tail:\n{stderr_tail}")
    else:
        _log(f"FAIL {prefix} stderr is empty")
    raise HTTPException(
        status_code=500,
        detail=f"{prefix} exit {proc.returncode}: {stderr_tail}",
    )


def _target_px_from_size(size: str | None) -> tuple[int, int] | None:
    inches = _hoop_inches_from_size(size)
    if inches is None:
        return None
    return int(inches[0] * EMBROIDERY_DPI), int(inches[1] * EMBROIDERY_DPI)


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


def _hoop_inches_from_size(size: str | None) -> tuple[float, float] | None:
    """Canonical hoop-size parser. "4x4", "5x7", "4×4" → (w_in, h_in). The
    px and mm variants delegate here so the parse rule lives in one place."""
    if not size:
        return None
    try:
        w_s, h_s = size.lower().replace("×", "x").split("x")
        return float(w_s), float(h_s)
    except (ValueError, AttributeError):
        return None


def _hoop_mm_from_size(size: str | None) -> tuple[float, float] | None:
    inches = _hoop_inches_from_size(size)
    if inches is None:
        return None
    return inches[0] * 25.4, inches[1] * 25.4


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


def _to_palette_image(arr: np.ndarray, palette_bytes) -> Image.Image:
    """Wrap a HxW uint8 index array back into a P-mode PIL Image and restamp
    its palette. Centralizes the from-array → putpalette dance the pipeline
    runs after every numpy-side bucket mutation."""
    out = Image.fromarray(arr, mode="P")
    out.putpalette(palette_bytes)
    return out


def _to_thread_palette_image(arr: np.ndarray, hex_palette: list[str]) -> Image.Image:
    """Same as _to_palette_image but takes a hex palette and lays down the
    proper PIL-padded 768-byte palette under the hood."""
    pal_img = _palette_image(hex_palette)
    return _to_palette_image(arr, pal_img.getpalette() or [])


def _bucket_mask(img: Image.Image, idx: int) -> Image.Image:
    """Return an L-mode mask where pixels matching palette index `idx` are
    255 and everything else is 0. Replaces the recurring `quantized.point(
    lambda p, i=idx: 255 if p == i else 0, mode="L")` pattern."""
    return img.point(lambda p, i=idx: 255 if p == i else 0, mode="L")


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


def _detect_corner_background(
    rgb_arr: np.ndarray, tolerance: int = 22, patch: int = 5
) -> tuple[Image.Image, tuple[int, int, int], int] | None:
    """Detect a uniform background color by sampling the 4 image corners. If
    ≥3 corners share a color (within `tolerance` per channel, median over a
    `patch`×`patch` window for JPG/grain robustness), return an L-mode mask
    of every pixel within tolerance of that color AND 4-connected to at
    least one of those corners via flood-fill, plus the sampled BG color and
    the matching-corner count. Returns None if fewer than 3 corners agree.

    Catches solid / quasi-solid colored backgrounds the near-white paper
    strip misses — tan canvas, blue card stock, grunge-textured backdrop.
    Flood-fill connectivity prevents the mask from claiming interior design
    pixels that happen to share the BG color (e.g. a tan boot in the design
    on a tan canvas — the boot is enclosed by darker outline pixels, so the
    corner-seeded flood can't reach it)."""
    h, w = rgb_arr.shape[:2]
    p = max(1, patch // 2)
    # Inset off the literal image edge so the sample doesn't land on JPEG
    # re-encode artifacts, vignettes, or torn-paper edges that don't represent
    # the actual background. ~1% of the shorter side, floor 3 px. Without this
    # a 1-pixel dark stripe along the right edge of a tan-kraft photo splits
    # the 4 corners into a 2-vs-2 disagreement (left corners read tan, right
    # corners read edge-stripe), the ≥3 threshold fails, and the kraft never
    # gets stripped.
    inset = max(3, min(w, h) // 100)
    corners_xy = [
        (inset, inset),
        (w - 1 - inset, inset),
        (inset, h - 1 - inset),
        (w - 1 - inset, h - 1 - inset),
    ]

    def _sample(x: int, y: int) -> np.ndarray:
        x0, x1 = max(0, x - p), min(w, x + p + 1)
        y0, y1 = max(0, y - p), min(h, y + p + 1)
        return np.median(
            rgb_arr[y0:y1, x0:x1].reshape(-1, 3), axis=0
        ).astype(np.int16)

    corner_rgbs = [_sample(x, y) for x, y in corners_xy]

    bg_color: np.ndarray | None = None
    bg_seeds: list[tuple[int, int]] = []
    for i in range(4):
        group = [corners_xy[i]]
        for j in range(4):
            if i == j:
                continue
            if int(np.abs(corner_rgbs[i] - corner_rgbs[j]).max()) <= tolerance:
                group.append(corners_xy[j])
        if len(group) >= 3:
            bg_color = corner_rgbs[i]
            bg_seeds = group
            break

    if bg_color is None:
        return None

    diff = np.abs(rgb_arr.astype(np.int16) - bg_color[None, None, :])
    matches = (diff.max(axis=2) <= tolerance).astype(np.uint8) * 255
    # Choke-point bridging. Two design elements that nearly touch (a lightning
    # bolt + the leg of an "H", a comma + a serif) close their anti-alias
    # halos across a 1–2 px gap, cutting the background mask into disconnected
    # components. The corner-seeded flood reaches only the component touching
    # the corner — everything past the choke stays un-stripped and gets traced
    # as a stitch layer. Dilating `matches` before the flood bridges those
    # narrow gaps so the flood reaches every actually-bg-colored region; the
    # AND-back at the end discards the dilated halo so we don't claim non-bg
    # pixels. 5×5 kernel bridges gaps up to ~4 px, conservative enough that
    # genuinely-disconnected interior bg-colored pockets (rare) stay isolated.
    bridge_kernel = np.ones((5, 5), dtype=np.uint8)
    matches_bridged = cv2.dilate(matches, bridge_kernel, iterations=1)
    near_bg = Image.fromarray(matches_bridged, mode="L")
    scratch = near_bg.copy()
    for sx, sy in bg_seeds:
        if scratch.getpixel((sx, sy)) == 255:
            ImageDraw.floodfill(scratch, (sx, sy), 128)
    flooded = scratch.point(lambda p: 255 if p == 128 else 0, mode="L")
    strict = Image.fromarray(matches, mode="L")
    result = ImageChops.darker(flooded, strict)
    bridged_extra = int((matches_bridged > 0).sum() - (matches > 0).sum())

    # Enclosed pocket absorb. Some bg-colored regions are fully enclosed by
    # design (e.g. the kraft-paper gap between the eagle's spread wings and
    # the curved "American" lettering above it — surrounded by text and
    # body pixels with no path to any image corner). The corner-seeded flood
    # can't reach them, so they survive as a stitched layer that looks
    # nothing like the design. Sweep the strict-match mask for connected
    # components NOT touched by the corner flood and absorb the ones whose
    # mean RGB matches the corner-flood's mean to within a tight tolerance —
    # that's the signature of "same kraft, just unreachable" vs. "a tan
    # design element that happens to land in matches." Size-gated to avoid
    # claiming small interior noise pockets.
    result_arr = np.array(result, dtype=np.uint8)
    strict_arr = np.array(strict, dtype=np.uint8)
    flood_mask_bool = result_arr > 0
    absorbed_pockets = 0
    absorbed_pixels = 0
    if flood_mask_bool.any():
        flood_mean = rgb_arr[flood_mask_bool].mean(axis=0)
        # Min pocket size scales with image area; floor at 100 px so noise
        # specks don't get claimed even on tiny images.
        min_pocket_area = max(100, (h * w) // 2000)
        # Tighter than the 22-tolerance used to enter `matches` at all —
        # accommodates JPEG / kraft lighting variance but rejects subject
        # elements that happen to be in-tolerance of the corner color.
        POCKET_MEAN_TOLERANCE = 12
        enclosed = strict_arr.copy()
        enclosed[flood_mask_bool] = 0
        num, labels = cv2.connectedComponents(enclosed, connectivity=8)
        if num > 1:
            # Vectorized per-label stats. A naive `for lbl in range(1, num): cc =
            # labels == lbl; rgb_arr[cc].mean()` loop runs O(K·N) where N is the
            # full-res pixel count (14.8M at 4000×3695) and K can be hundreds of
            # CCs — minutes of wall-time. bincount does it in one pass: O(N·3)
            # for the sums and O(N) for the counts, then we read per-label means
            # in O(K).
            flat_labels = labels.reshape(-1)
            flat_rgb = rgb_arr.reshape(-1, 3).astype(np.int64)
            counts = np.bincount(flat_labels, minlength=num)
            sums = np.empty((num, 3), dtype=np.int64)
            for c in range(3):
                sums[:, c] = np.bincount(flat_labels, weights=flat_rgb[:, c], minlength=num).astype(np.int64)
            safe_counts = np.maximum(counts, 1).astype(np.float64)
            means = sums.astype(np.float64) / safe_counts[:, None]
            diffs = np.abs(means - flood_mean[None, :]).max(axis=1)
            qualifying = np.where(
                (counts >= min_pocket_area) & (diffs <= POCKET_MEAN_TOLERANCE)
            )[0]
            qualifying = qualifying[qualifying > 0]  # exclude label 0 (background)
            if qualifying.size > 0:
                claim_mask = np.isin(labels, qualifying)
                result_arr[claim_mask] = 255
                absorbed_pockets = int(qualifying.size)
                absorbed_pixels = int(counts[qualifying].sum())
                result = Image.fromarray(result_arr, mode="L")

    # Edge-band sweep. The corner sample insets by `inset` px to dodge JPEG /
    # vignette artifacts at the literal edge, which means a torn-paper stripe,
    # scanner shadow, or framing line living entirely inside that band never
    # gets in-tolerance of the corner color and survives as a trace layer
    # (typically quantized to whichever palette color is RGB-nearest — e.g. a
    # dark-brown wood edge becoming a thin red stitch sliver). Sweep CCs of
    # the unclaimed region: any CC that touches the image edge AND fits
    # entirely inside the edge band is an edge-only artifact, not a design
    # element extending to the edge (a real subject crossing the band would
    # have most of its mass in the interior). Claim those for the bg mask.
    edge_band = inset
    edge_absorbed_ccs = 0
    edge_absorbed_pixels = 0
    if edge_band > 0:
        unclaimed = (result_arr == 0).astype(np.uint8)
        # Skip if everything's already claimed or the unclaimed region is
        # one giant blob (no corner-flood happened reliably).
        if unclaimed.any():
            num_u, labels_u = cv2.connectedComponents(unclaimed, connectivity=8)
            if num_u > 1:
                band = np.zeros((h, w), dtype=bool)
                band[:edge_band, :] = True
                band[h - edge_band:, :] = True
                band[:, :edge_band] = True
                band[:, w - edge_band:] = True
                total_counts = np.bincount(labels_u.ravel(), minlength=num_u)
                in_band_counts = np.bincount(
                    labels_u[band].ravel(), minlength=num_u
                )
                edge_labels = set()
                edge_labels.update(labels_u[0, :].tolist())
                edge_labels.update(labels_u[h - 1, :].tolist())
                edge_labels.update(labels_u[:, 0].tolist())
                edge_labels.update(labels_u[:, w - 1].tolist())
                edge_labels.discard(0)
                touches = np.zeros(num_u, dtype=bool)
                if edge_labels:
                    touches[np.array(sorted(edge_labels), dtype=np.int64)] = True
                # Entirely-in-band AND touches edge AND non-trivial size. The
                # size floor is intentionally tiny — these are edge-only
                # artifacts; a 4-px speck on the edge is still noise we'd
                # rather absorb than trace as its own thread layer.
                qualifying_edge = np.where(
                    (in_band_counts == total_counts) & touches & (total_counts >= 4)
                )[0]
                qualifying_edge = qualifying_edge[qualifying_edge > 0]
                if qualifying_edge.size > 0:
                    edge_claim = np.isin(labels_u, qualifying_edge)
                    result_arr[edge_claim] = 255
                    edge_absorbed_ccs = int(qualifying_edge.size)
                    edge_absorbed_pixels = int(total_counts[qualifying_edge].sum())
                    result = Image.fromarray(result_arr, mode="L")

    _log(
        f"  corner-bg bridging: dilated {bridged_extra}px to close choke gaps; "
        f"pocket absorb: {absorbed_pockets} enclosed regions ({absorbed_pixels}px) "
        f"matched corner-flood mean and were claimed as background; "
        f"edge-band sweep ({edge_band}px): {edge_absorbed_ccs} edge-only CCs "
        f"({edge_absorbed_pixels}px) absorbed"
    )
    return (
        result,
        (int(bg_color[0]), int(bg_color[1]), int(bg_color[2])),
        len(bg_seeds),
    )


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


def _compute_body_strip_mask(
    paper_mask: Image.Image,
    dark_mask: Image.Image | None,
    extract_outline: bool,
) -> Image.Image:
    """Union of paper + former-outline pixels. Subtracted from every body
    color bucket so no body color stitches where the outline used to be
    (the outline layer covers that itself). When outline extraction is off,
    only paper is stripped — there is no dark_mask. Recompute whenever
    paper_mask is mutated downstream."""
    if extract_outline and dark_mask is not None:
        return ImageChops.lighter(paper_mask, dark_mask)
    return paper_mask


# Color-preserve trace: cap quantization at this many buckets. Higher than
# embroidery's typical 12 because there's no thread-palette budget to honor —
# 48 gives MEDIANCUT enough headroom to keep saturated minority regions (a
# small gold lightning-bolt next to a dominant tan kraft) on their own
# centroid instead of folding them into the larger neighbor.
COLOR_PRESERVE_COLORS = 48

# Target long-edge resolution for color-preserve runs. The embroidery trace
# UPSCALES the input to its hoop's 500-DPI grid (e.g. 2500 px for a 5" hoop)
# and every kernel — mode filter, +1 mask dilate, dark pre-dilate, turdsize,
# the outline-luma threshold — is calibrated for that grid. Passing a tiny
# 695-px source at size=None traces at the SAME kernel sizes but the kernels
# are now proportionally too aggressive vs. the image's features, producing
# visible line-overgrowth. Pre-resizing to ~2000 px restores the embroidery-
# calibrated kernel-to-feature ratio. The bound is both ceiling (don't trace
# a 4K photo at native res — slow + nothing gained past quantize resolution)
# and floor (upscale small inputs so kernels behave).
COLOR_PRESERVE_TARGET_LONG_EDGE = 2000


def _trace_color_preserve(image_bytes: bytes) -> bytes:
    """Run the embroidery trace pipeline without any thread-palette
    constraints. PIL handles input format (PNG/JPG/WebP/GIF/BMP); the image
    is resized to ~2000 px long edge so the embroidery-calibrated kernel
    sizes (mode filter, +1 dilates, turdsize) stay proportional to features;
    `_trace_png` with no `palette` falls through to MEDIANCUT with its own
    self-selected centroids and runs every quality pass (outline extract,
    dark-bucket protect, mode filter, bucket merge, coverage floor, border-
    island absorb, speck absorb) the embroidery side relies on. The
    resulting SVG fills each layer with the source's own pixel median for
    that bucket — no thread snapping."""
    _log(f"trace_color_preserve start bytes={len(image_bytes)}")
    opened = Image.open(io.BytesIO(image_bytes))
    has_alpha = (
        opened.mode in ("RGBA", "LA")
        or (opened.mode == "P" and "transparency" in opened.info)
    )
    img = opened.convert("RGBA" if has_alpha else "RGB")

    long_edge = max(img.size)
    resized = False
    if long_edge != COLOR_PRESERVE_TARGET_LONG_EDGE:
        scale = COLOR_PRESERVE_TARGET_LONG_EDGE / long_edge
        new_size = (max(1, round(img.size[0] * scale)), max(1, round(img.size[1] * scale)))
        img = img.resize(new_size, Image.LANCZOS)
        resized = True
        _log(
            f"trace_color_preserve {'upscaled' if scale > 1 else 'downscaled'} "
            f"{long_edge}px long edge -> {new_size}"
        )

    # Re-encode as PNG bytes — `_trace_png` re-opens via PIL, so any PIL-
    # readable format works, but PNG keeps alpha exactly when present.
    if resized or opened.format != "PNG":
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()
        _log(f"trace_color_preserve re-encoded to PNG {len(png_bytes)} bytes")
    else:
        png_bytes = image_bytes

    return _trace_png(
        png_bytes,
        num_colors=COLOR_PRESERVE_COLORS,
        size=None,
        recolor_from_source=True,
    )


def _trace_png(
    png_bytes: bytes,
    num_colors: int = DEFAULT_TRACE_COLORS,
    size: str | None = None,
    palette: list[str] | None = None,
    extract_outline_override: bool | None = None,
    clusters: list[str] | None = None,
    routes: list[int] | None = None,
    skip_indices: list[int] | None = None,
    recolor_from_source: bool = False,
) -> bytes:
    _log(
        f"trace_png start bytes={len(png_bytes)} size={size} colors={num_colors} "
        f"palette={palette} extract_outline_override={extract_outline_override} "
        f"clusters={len(clusters) if clusters else 0} routes={len(routes) if routes else 0} "
        f"skip_indices={skip_indices}"
    )

    # Low-contrast detection. When the source's cluster spread is small, the
    # image is monochromatic (warm-toned line art, flat illustration on tinted
    # paper, watercolor in one hue) — there is no paper-white to strip, and
    # the lightest cluster IS one of the design colors. If we honor the AI's
    # "background" role anyway, the chroma rescue collapses the stripped
    # pixels into the nearest surviving thread, merging two semantically
    # distinct regions into one muddy blob. Suppress skip_indices in that
    # case so every picked thread keeps its own bucket. Computed from the
    # `clusters` querystring directly — same source the AI saw — so callers
    # don't need to pass a separate flag.
    LOW_CONTRAST_THRESHOLD = 150  # match the TS-side threshold in select-palette.ts
    if skip_indices and clusters and len(clusters) >= 2:
        try:
            cluster_rgb = _hex_list_to_rgb_array(clusters, dtype=np.int32)
            diff = cluster_rgb[:, None, :] - cluster_rgb[None, :, :]
            spread = int(round(float(np.sqrt((diff * diff).sum(axis=2).max()))))
        except Exception:
            spread = -1
        if 0 < spread < LOW_CONTRAST_THRESHOLD:
            _log(
                f"trace_png low-contrast image detected (cluster_spread={spread} < "
                f"{LOW_CONTRAST_THRESHOLD}) — suppressing skip_indices={skip_indices} "
                f"so the lightest thread isn't merged into the next-nearest one"
            )
            skip_indices = None
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
    # Drop anything under ~4 mm² inside potrace. The JS-side geometry prefilter
    # uses the same floor (SPECK_MM2 in prefilter.ts — keep them in lockstep).
    # 4 mm² ≈ a 2×2 mm feature, which is the practical floor for what reads on
    # the embroidery machine: thread is ~0.4 mm wide, so anything smaller is
    # either fewer than ~5 stitches across or a single satin strand and won't
    # survive stitching cleanly. Earlier setting (0.25 mm²) preserved leaf
    # veins and sub-mm subtext, but those never survived the machine anyway —
    # they only survived the pipeline and inflated path counts past
    # inkstitch's 255-color-stop ceiling. If a design genuinely needs sub-mm
    # detail, the right answer is a bigger hoop (more px/mm), not a finer
    # turdsize.
    turdsize_px = max(MIN_TURDSIZE_PX, round(px_per_mm * px_per_mm * 4.0))
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
    # Paper detection: high brightness AND low chroma. Brightness alone catches
    # watercolor highlight tints that lighten to "almost-white" — those pixels
    # then chain via the border-flood through any halo gradient into the
    # interior highlights, eating them. Requiring near-zero chroma (channel
    # spread ≤ PAPER_MAX_CHROMA) keeps tinted near-whites out of the paper
    # bucket while still catching real off-white paper.
    rgb_arr = np.array(img, dtype=np.uint8)
    r_arr = rgb_arr[:, :, 0]
    g_arr = rgb_arr[:, :, 1]
    b_arr = rgb_arr[:, :, 2]
    paper_candidate = _paper_pixel_mask_np(rgb_arr)

    # Thread-bias gate: even when a pixel passes the brightness+chroma paper
    # criteria, prefer the AI palette over paper if any thread is meaningfully
    # close. Specifically: paper wins only if dist(pixel, white) < ~0.538 *
    # dist(pixel, nearest non-skip thread) — i.e. paper has to be SIGNIFICANTLY
    # closer than thread. Equivalent framing: a pixel that's 35%+ of the way
    # toward a real thread color (vs paper) is classified as thread, not paper.
    # This rescues borderline highlights where Lily White / very pale picks are
    # within reach but vanilla nearest-neighbor would call them paper.
    if palette and len(palette) > 0:
        skip_set = set(skip_indices or [])
        thread_rgbs: list[tuple[int, int, int]] = []
        for i, hex_color in enumerate(palette):
            if i in skip_set:
                continue
            rgb = _hex_to_rgb(hex_color)
            if rgb is not None:
                thread_rgbs.append(rgb)
        if thread_rgbs:
            r_int = r_arr.astype(np.int32)
            g_int = g_arr.astype(np.int32)
            b_int = b_arr.astype(np.int32)
            white_dist_sq = (255 - r_int) ** 2 + (255 - g_int) ** 2 + (255 - b_int) ** 2
            min_thread_dist_sq = np.full(r_int.shape, np.iinfo(np.int32).max, dtype=np.int32)
            for t_r, t_g, t_b in thread_rgbs:
                dist_sq = (r_int - t_r) ** 2 + (g_int - t_g) ** 2 + (b_int - t_b) ** 2
                min_thread_dist_sq = np.minimum(min_thread_dist_sq, dist_sq)
            # paper wins if white_dist² < (35/65)² * thread_dist² = ~0.289 * thread_dist²
            paper_wins = (
                white_dist_sq.astype(np.float64)
                < 0.2899408 * min_thread_dist_sq.astype(np.float64)
            )
            rescued = int(paper_candidate.sum() - (paper_candidate & paper_wins).sum())
            paper_candidate = paper_candidate & paper_wins
            if rescued > 0:
                _log(
                    f"trace_png paper rescue: {rescued} pixels kept as thread "
                    f"(closer to a palette thread than to pure white)"
                )

    near_white_arr = paper_candidate.astype(np.uint8) * 255
    near_white = Image.fromarray(near_white_arr, mode="L")
    paper_mask = _border_connected_mask(near_white)

    # Corner-color background strip. The near-white paper detection above
    # only catches white/cream paper; a solid colored canvas (tan poster,
    # grunge backdrop, blue card stock) sails through and gets stitched as
    # design. If ≥3 of the 4 image corners share a color (median-sampled
    # for JPG/grain robustness), flood-fill from those corners through the
    # matching-color region and union the result into paper_mask. The flood
    # is connectivity-bounded — interior design regions that happen to share
    # the BG hex (a tan boot, a cream shirt) survive because no corner-rooted
    # path of BG-colored pixels can reach them.
    corner_bg = _detect_corner_background(rgb_arr)
    if corner_bg is not None:
        corner_mask, bg_rgb, agree = corner_bg
        before = int((np.array(paper_mask, dtype=np.uint8) > 0).sum())
        paper_mask = ImageChops.lighter(paper_mask, corner_mask)
        after = int((np.array(paper_mask, dtype=np.uint8) > 0).sum())
        _log(
            f"trace_png corner-bg detected rgb={bg_rgb} ({agree}/4 corners agree); "
            f"flood added {after - before} pixels to paper_mask"
        )

    if alpha_bg_mask is not None:
        # User-authored alpha is authoritative. Every alpha=0 pixel is a
        # deliberate hole — including interior cutouts that the border-flood
        # can't reach.
        paper_mask = ImageChops.lighter(paper_mask, alpha_bg_mask)
    # Paper-only mask is kept for the outline's own subtraction so we don't
    # erase the outline from its own trace.
    body_strip_mask = _compute_body_strip_mask(
        paper_mask, dark_mask if extract_outline else None, extract_outline
    )
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
        thread_lab = [_srgb_to_lab(*_hex_to_rgb_or_black(h)) for h in palette]
        lut = np.zeros(256, dtype=np.uint8)
        ai_routed = 0
        fallback_routed = 0
        steered = 0
        for i, cluster_hex in enumerate(clusters):
            thread_idx = routes[i] if i < len(routes) else -1
            if thread_idx >= 0:
                lut[i] = thread_idx
                ai_routed += 1
            else:
                # Fallback: nearest thread by COLOR-WEIGHTED Lab distance —
                # chroma and hue weighted heavier than lightness. Plain ΔE
                # puts a pale-pink body cluster closer to Lily White than to
                # Dusty Rose because the lightness gap to DR dominates, even
                # though chromatically the cluster clearly wants the pink
                # thread. Weighting hue arc by cluster_chroma² makes truly
                # grey clusters fall back to pure-Lab behavior automatically.
                c_lab = _srgb_to_lab(*_hex_to_rgb_or_black(cluster_hex))
                best = min(
                    range(len(palette)),
                    key=lambda j: _color_weighted_lab_dist_sq(c_lab, thread_lab[j]),
                )
                # Telemetry: count when color weighting changed the pick.
                naive_best = min(
                    range(len(palette)),
                    key=lambda j: _lab_distance_sq(c_lab, thread_lab[j]),
                )
                if naive_best != best:
                    steered += 1
                lut[i] = best
                fallback_routed += 1
        cluster_arr = np.array(quantized_clusters, dtype=np.uint8)
        remapped_arr = lut[cluster_arr]
        # Repalette the remapped image with the THREAD palette so downstream
        # code reads correct RGB values via getpalette().
        quantized = _to_thread_palette_image(remapped_arr, palette)
        _log(
            f"trace_png quantize done in {time.time()-t0:.2f}s "
            f"(AI-routed clusters: {ai_routed} routed by AI, {fallback_routed} by "
            f"color-weighted Lab fallback [{steered} re-steered by color weighting], "
            f"{len(palette)} threads)"
        )
    elif palette:
        # Color-weighted quantize: replaces PIL's RGB-Euclidean nearest with our
        # (ΔL, ΔC, ΔH) decomposition. Without this, pale-pink body pixels would
        # bucket to Lily White instead of Dusty Rose because plain RGB distance
        # is brightness-dominated. Used whenever we have an AI palette but no
        # cluster routing — i.e. when /sample-colors failed, returned empty, or
        # the AI didn't emit per-cluster routes.
        quantized = _color_weighted_quantize(body_img, palette)
        _log(
            f"trace_png quantize done in {time.time()-t0:.2f}s "
            f"(AI palette, color-weighted Lab, {ai_palette_count} colors)"
        )
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

    # Chroma rescue: pixels routed to a background-role thread but with
    # measurable per-pixel chroma get reassigned to the nearest non-background
    # thread before the strip runs. Cluster-level routing carries paper-white
    # edge pixels and light-peach subject pixels in the same bucket whenever
    # the cluster's centroid lands near white — without this gate, an
    # alligator's light-peach chest gets thrown out wholesale with the paper
    # because its cluster averaged to "close enough to white." Acting per-
    # pixel means a chest pixel survives even if its cluster centroid drifted.
    if skip_indices and ai_palette_count > 0 and palette:
        non_bg = [i for i in range(ai_palette_count) if i not in skip_indices]
        if non_bg:
            body_arr = np.array(body_img.convert("RGB"), dtype=np.uint8)
            r_arr = body_arr[:, :, 0].astype(np.int16)
            g_arr = body_arr[:, :, 1].astype(np.int16)
            b_arr = body_arr[:, :, 2].astype(np.int16)
            chroma_arr = _chroma_array(body_arr)
            q_arr = np.array(quantized, dtype=np.uint8)
            bg_routed = np.zeros(q_arr.shape, dtype=bool)
            for s in skip_indices:
                bg_routed |= (q_arr == s)
            rescue_mask = bg_routed & (chroma_arr > PAPER_PIXEL_MAX_CHROMA)
            rescue_count = int(rescue_mask.sum())
            if rescue_count > 0:
                # Vectorized RGB-nearest among non-bg threads. Chroma is
                # RGB-derived so matching back in RGB stays internally
                # consistent. int32 cast to avoid uint8 overflow in the
                # squared-diff sum.
                thread_rgb = _hex_list_to_rgb_array(
                    [palette[i] for i in non_bg], dtype=np.int32
                )
                pix = np.stack(
                    [r_arr[rescue_mask], g_arr[rescue_mask], b_arr[rescue_mask]],
                    axis=1,
                ).astype(np.int32)
                d = ((pix[:, None, :] - thread_rgb[None, :, :]) ** 2).sum(axis=2)
                nearest_sub = np.argmin(d, axis=1)
                non_bg_arr = np.array(non_bg, dtype=np.uint8)
                q_arr[rescue_mask] = non_bg_arr[nearest_sub]
                quantized = _to_thread_palette_image(q_arr, palette)
                _log(
                    f"trace_png chroma gate rescued {rescue_count} pixels "
                    f"from background-role strip "
                    f"(threshold={PAPER_PIXEL_MAX_CHROMA})"
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
            body_strip_mask = _compute_body_strip_mask(
                paper_mask, dark_mask if extract_outline else None, extract_outline
            )
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

    # Identify the darkest active bucket in the AI palette. It's the one most
    # likely to carry structural-contour duty (gator outlines, letter strokes,
    # etc.). Two failure modes hit it without intervention:
    #   1. LANCZOS upscale of thin source strokes creates a feathered gradient
    #      (the 2px source outline becomes ~8px in target with ~3px of mixed
    #      gradient on each side). The gradient pixels RGB-bucket to the
    #      lighter neighbor at quantize-time, leaving only the 2-px center as
    #      dark — the visible outline appears ~75% lighter than intended.
    #   2. The mode filter's neighborhood-majority vote can erode the dark
    #      band further wherever it passes through lighter surroundings.
    # Fix both by (a) pre-dilating the darkest bucket by ~0.15 mm so it
    # reclaims the upscale gradient zone, then (b) re-stamping the pre-filter
    # dark mask after ModeFilter runs so neighborhood-majority can't undo it.
    palette_now = quantized.getpalette() or []
    protected_idx: int | None = None
    if ai_palette_count > 0:
        hist_now = quantized.histogram()
        ai_active = [
            i
            for i in range(ai_palette_count)
            if i * 3 + 2 < len(palette_now)
            and (i < len(hist_now) and hist_now[i] > 0)
            and (not skip_indices or i not in set(skip_indices))
        ]
        if ai_active:
            def _bucket_lstar(i: int) -> float:
                r = palette_now[i * 3]
                g = palette_now[i * 3 + 1]
                b = palette_now[i * 3 + 2]
                return _srgb_to_lab(r, g, b)[0]
            protected_idx = min(ai_active, key=_bucket_lstar)
            _log(
                f"trace_png mode_filter protect darkest_bucket idx={protected_idx} "
                f"L*={_bucket_lstar(protected_idx):.1f}"
            )

    # Tuned so the kernel covers the LANCZOS upscale gradient zone at every
    # supported hoop size. At 8×8 (px_per_mm ≈ 19.7) this lands at a 9-px
    # kernel = 4 px of dilation each side, which reaches the faint outer
    # gradient band (15–25% dark intensity) that 0.3mm/3-px-each-side missed,
    # leaving thin outlines visibly under-thickened. At 4×4 (px_per_mm ≈ 9.8)
    # it scales to a 5-px kernel = 2 px each side, still safely inside the
    # actual gradient there.
    DARK_DILATE_MM = 0.4
    if protected_idx is not None:
        dilate_px = _odd_kernel_for_mm(px_per_mm, DARK_DILATE_MM, minimum=3)
        if dilate_px > 1:
            arr = np.array(quantized, dtype=np.uint8)
            dark_mask_arr = (arr == protected_idx).astype(np.uint8) * 255
            dilated_arr = np.array(
                Image.fromarray(dark_mask_arr, mode="L").filter(
                    ImageFilter.MaxFilter(size=dilate_px)
                ),
                dtype=np.uint8,
            )
            paper_arr = np.array(paper_mask, dtype=np.uint8)
            new_dark = (
                (dilated_arr > 0)
                & (arr != protected_idx)
                & (paper_arr == 0)
            )
            if skip_indices:
                for s in skip_indices:
                    new_dark &= arr != s

            # L* gate. The dilation is intended to reclaim the soft LANCZOS
            # upscale gradient zone — faint dark pixels (L* a bit above the
            # outline's L*) that ended up in a neighboring bucket due to
            # median-cut imprecision. On crisp logo/vector inputs there is no
            # gradient zone; without this gate the dilation eats thin BRIGHT
            # neighbors like eye whites, beak interiors, and small white
            # feather flecks against a black outline. Cap absorption at the
            # midpoint between the protected bucket's L* and the next-darkest
            # active bucket's L*: gradient pixels (well below midpoint) pass,
            # actually-light pixels (well above midpoint) stay where they are.
            protected_L = _bucket_lstar(protected_idx)
            other_active = [i for i in ai_active if i != protected_idx]
            if other_active:
                next_L = min(_bucket_lstar(i) for i in other_active)
                lstar_cap = (protected_L + next_L) / 2.0
                # Per-pixel L* from the current body_img (same source the
                # quantizer saw — re-derive in case halo-inpaint or chroma-
                # rescue updated body_img after the last body_arr snapshot).
                # Vectorized via _srgb_to_lab_arr — no per-pixel Python loop.
                body_rgb_now = np.array(body_img.convert("RGB"), dtype=np.uint8)
                pixel_L = _srgb_to_lab_arr(body_rgb_now)[..., 0]
                lstar_ok = pixel_L < lstar_cap
                before = int(new_dark.sum())
                new_dark &= lstar_ok
                after = int(new_dark.sum())
                _log(
                    f"trace_png pre-dilate L* gate: protected_L={protected_L:.1f} "
                    f"next_L={next_L:.1f} cap={lstar_cap:.1f} — kept {after}/{before} "
                    f"candidates ({before - after} bright pixels protected)"
                )

            new_dark_count = int(new_dark.sum())
            if new_dark_count > 0:
                arr[new_dark] = protected_idx
                quantized = _to_palette_image(arr, palette_now)
                _log(
                    f"trace_png pre-dilate darkest_bucket idx={protected_idx} "
                    f"by {dilate_px}px ({DARK_DILATE_MM}mm), +{new_dark_count} px "
                    f"(reclaims LANCZOS upscale gradient zone)"
                )

    pre_filter_palette = quantized.getpalette() or []
    pre_filter_arr = np.array(quantized, dtype=np.uint8)

    quantized = quantized.filter(ImageFilter.ModeFilter(size=mode_size))

    if protected_idx is not None:
        post_arr = np.array(quantized, dtype=np.uint8)
        protected_mask = pre_filter_arr == protected_idx
        restored = int(
            (protected_mask & (post_arr != protected_idx)).sum()
        )
        if restored > 0:
            post_arr[protected_mask] = protected_idx
            quantized = _to_palette_image(post_arr, pre_filter_palette)
            _log(
                f"trace_png mode_filter restored {restored} px to darkest bucket "
                f"idx={protected_idx} (would have been absorbed into neighbors)"
            )

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

    # Close out anti-alias bleed between a colored border and its dominant
    # fill. For any kept-bucket CC that encloses a clearly-dominant interior,
    # reassign the third-color "band" inside a small dilation band of the
    # border to the dominant interior bucket. Runs AFTER speck absorb so
    # only meaningful (≥turdsize) bands remain — sub-speck noise has already
    # been folded into its majority neighbor.
    if used_indices:
        quantized, border_reassigned, border_hits = _absorb_border_island_strays(
            quantized, used_indices, palette, px_per_mm,
            body_strip_mask=body_strip_mask,
        )
        if border_reassigned > 0:
            _log(
                f"trace_png border-island absorb: {border_reassigned} px "
                f"reassigned across {border_hits} border CCs"
            )

    # Pre-compute the union of all kept buckets' pixels, used below to keep
    # each bucket's +1 px dilation from growing into a neighboring bucket's
    # interior (a dark border's dilation would otherwise eat a small bright
    # petal's interior). After the speck-absorb pass above there are no
    # sub-turdsize islands, so this raw-membership subtract is safe.
    union_kept_mask = Image.new("L", quantized.size, 0)
    for _k in used_indices:
        union_kept_mask = ImageChops.lighter(union_kept_mask, _bucket_mask(quantized, _k))

    # Source-pixel recoloring for color-preserve mode. MEDIANCUT centroids are
    # arithmetic means over every pixel in a bucket, including anti-alias edge
    # pixels at color boundaries — those mid-tones pull the centroid away from
    # the bucket's actual dominant color (e.g. a saturated gold bolt averages
    # with its kraft-halo ring and lands on a desaturated peach). Replacing
    # each kept bucket's palette entry with the per-channel MEDIAN of source
    # pixels in that bucket is outlier-robust, and eroding the bucket mask by
    # 1 px first drops the boundary ring entirely so the sample is "pure
    # interior" pixels — the dominant true color, not a mix with neighboring
    # buckets' anti-alias. Layer membership doesn't change (we don't touch
    # the quantize array), just the fill color the SVG paints with. Embroidery
    # callers leave this off — they want exact thread-palette hexes.
    if recolor_from_source and used_indices:
        body_rgb = np.array(body_img.convert("RGB"), dtype=np.uint8)
        q_arr = np.array(quantized, dtype=np.uint8)
        new_palette = list(palette)
        for idx in used_indices:
            mask = q_arr == idx
            if not mask.any():
                continue
            # Erode mask by 1 px so anti-alias edge pixels are excluded from
            # the median sample. Fall back to the full mask if erosion wipes
            # the bucket (very thin features like 1-px lines).
            mask_img = Image.fromarray(mask.astype(np.uint8) * 255, mode="L")
            eroded = np.array(
                mask_img.filter(ImageFilter.MinFilter(size=3)), dtype=np.uint8
            ) > 0
            sample_mask = eroded if eroded.any() else mask
            med = np.median(body_rgb[sample_mask], axis=0).astype(np.int32)
            new_palette[idx * 3] = int(med[0])
            new_palette[idx * 3 + 1] = int(med[1])
            new_palette[idx * 3 + 2] = int(med[2])
        palette = new_palette

    layer_fragments: list[str] = []
    for idx in sorted(used_indices):
        r, g, b = palette[idx * 3 : idx * 3 + 3]

        # Positive mask (bucket pixels = 255) for dilation, then flip for potrace
        # which traces black-on-white. Subtract body_strip_mask (paper + former-
        # outline) so body pixels don't START in those zones — the outline
        # pixels were whited-out before quantize, so their bucket assignment is
        # meaningless and must be excluded here.
        positive = _bucket_mask(quantized, idx)
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
        mask = ImageChops.invert(dilated)
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
        outline_positive = ImageChops.invert(outline_mask)
        outline_dilated = outline_positive.filter(ImageFilter.MaxFilter(size=MASK_DILATE_SIZE))
        outline_dilated = ImageChops.subtract(outline_dilated, paper_mask)
        outline_for_trace = ImageChops.invert(outline_dilated)
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
    # Off the event loop: _trace_png is fully synchronous (numpy/cv2 + potrace
    # subprocess.run), so calling it inline would block heartbeats to the
    # gunicorn master for the full trace duration and earn a SIGABRT.
    svg_bytes = await asyncio.to_thread(
        _trace_png,
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


@app.post("/trace-color")
async def trace_color(request: Request):
    _log("=== /trace-color received ===")
    if _JOB_SLOT.locked():
        _log("/trace-color rejected: slot busy")
        raise HTTPException(status_code=503, detail="Worker slot busy")
    async with _JOB_SLOT:
        image_bytes = await request.body()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty request body")
        t0 = time.time()
        try:
            svg_bytes = await asyncio.to_thread(_trace_color_preserve, image_bytes)
        except Exception as exc:
            _log(f"/trace-color failed: {type(exc).__name__}: {exc}")
            raise HTTPException(status_code=400, detail=f"trace failed: {exc}") from exc
        _log(f"=== /trace-color complete in {time.time()-t0:.2f}s, {len(svg_bytes)} bytes ===")
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

        # Off the event loop: subprocess.run is blocking. Inkstitch on dense
        # designs can run >10 minutes, and during that window the worker
        # otherwise can't heartbeat to gunicorn and gets SIGABRT'd at
        # --timeout. asyncio.to_thread parks it on a thread and keeps the
        # loop responsive. Same for the inkscape PNG export below.
        ink_proc = await asyncio.to_thread(_run, [
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
        png_proc = await asyncio.to_thread(_run, [
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

        _log(f"/convert zip assemble (inkstitch stdout {len(ink_proc.stdout)} bytes)")
        final_zip = io.BytesIO()
        try:
            with zipfile.ZipFile(io.BytesIO(ink_proc.stdout), "r") as src, \
                 zipfile.ZipFile(final_zip, "w", zipfile.ZIP_DEFLATED) as dst:
                for item in src.infolist():
                    dst.writestr(item, src.read(item.filename))
                dst.writestr("embroidery.bmp", bmp_buf.getvalue())
                dst.writestr("embroidery.svg", svg_bytes)
        except zipfile.BadZipFile as e:
            # Inkstitch returned 0 but its stdout isn't a valid zip. Common
            # causes: xvfb-run masked a child crash so rc=0 despite no output;
            # inkstitch printed a Python traceback to stdout instead of zip
            # bytes; or output got truncated mid-write. Dump enough context to
            # tell which.
            stdout_bytes = len(ink_proc.stdout or b"")
            stdout_preview = (ink_proc.stdout[:500] if ink_proc.stdout else b"").decode(
                "utf-8", errors="replace"
            )
            stderr_tail = (
                ink_proc.stderr.decode("utf-8", errors="replace")[-4000:]
                if ink_proc.stderr
                else ""
            )
            _log(f"FAIL zip parse: {e}")
            _log(
                f"FAIL inkstitch returned rc={ink_proc.returncode} "
                f"with {stdout_bytes} bytes of stdout (expected a zip)"
            )
            _log(f"FAIL inkstitch stdout[0:500]={stdout_preview!r}")
            if stderr_tail:
                _log(f"FAIL inkstitch stderr_tail:\n{stderr_tail}")
            raise HTTPException(
                status_code=500,
                detail=(
                    f"inkstitch produced {stdout_bytes} bytes of non-zip "
                    f"output (rc={ink_proc.returncode}): {e}. "
                    f"stderr_tail={stderr_tail}"
                ),
            )

        _log(f"=== /convert complete, zip_bytes={final_zip.tell()} ===")
        return Response(content=final_zip.getvalue(), media_type="application/zip")


# Gunicorn launches us with --preload so this module is imported once in the
# master before workers fork. Moving every currently-tracked object into the
# permanent generation exempts them from cyclic-GC traversal — which is what
# would otherwise write to gc bookkeeping inside object headers and break the
# copy-on-write sharing of those pages across forked children. Refcounts still
# churn on hot objects (gc.freeze isn't immortality, that's PEP 683), so the
# CoW preservation only sticks for stable module-level state: route table,
# constants, imported modules. Worth roughly 20-50 MB of additional shared
# RSS across N workers in our measurements — small per-worker but multiplies
# the number of workers we can fit in the same idle memory budget.
import gc
gc.freeze()

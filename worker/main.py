import asyncio
import io
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile

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

app = FastAPI()

INKSTITCH_PATH = os.environ.get("INKSTITCH_PATH", "/opt/inkstitch/inkstitch.py")

FORMATS = ["dst", "exp", "jef", "pes", "vp3", "xxx"]
ALLOWED_SIZES = {"4x4", "5x7", "6x10", "8x8"}
DEFAULT_TRACE_COLORS = 12
MIN_TRACE_COLORS = 2
MAX_TRACE_COLORS = 16
EMBROIDERY_DPI = 150   # trace resolution in px-per-inch. 62.5 matches the physical stitch-cell
                       # density but produces splotchy vector output; 150 gives potrace a 2.4x
                       # finer grid so thin outlines and small features survive cleanly. Ink/Stitch
                       # still picks its own stitch density when rasterizing the paths, so this
                       # only affects vector fidelity, not machine stitch count per area.
OUTLINE_LUMA_MAX = 80  # pixels darker than this are pulled out as a dedicated black layer. This
                       # captures both thick contour strokes (main outline) and thin interior
                       # texture lines. The downstream geometry prefilter classifies each traced
                       # black path by width: >0.6mm = fill (solid contour), ≤0.6mm = running stitch
                       # (thin detail line), so a single threshold gives us both layers cleanly.
                       # Also stops dark-stroke pixels from contaminating body color quantization,
                       # so similar body shades merge into one bucket instead of splotchy light/dark.
OUTLINE_MAX_FRACTION = 0.3  # if more than this share of the image is dark, skip outline extraction
                            # (dark-dominant art would otherwise strip its own body)
PAPER_CHANNEL_MIN = 240     # all of R,G,B above this = treat as paper; matches the post-quantize filter
                            # so paper pixels collapse into one throwaway bucket instead of stealing many
POTRACE_ALPHAMAX = 0.8      # corner threshold (potrace default 1.0); lower preserves sharper corners
POTRACE_OPTTOLERANCE = 0.2  # curve-fit tolerance (default 0.2); looser = fewer, smoother segments
MIN_TURDSIZE_PX = 2         # floor for resolution-scaled turdsize so we always drop single-pixel specks
MODE_FILTER_SIZE = 3        # per-pixel mode over this NxN neighborhood. 3 absorbs 1-2px specks
                            # while preserving thin 2px+ details (antennae, hair). Size 5 erases
                            # any thin curve narrower than its window. Bucket-mask dilation closes
                            # the larger holes that size-3 would leave behind.
MODE_FILTER_SIZE_PHOTO = 5  # more aggressive absorption when extract_outline=false (photos) —
                            # photos lack crisp thin features to preserve, and merging specks
                            # dramatically cuts the path count inkstitch has to plan through.
MASK_DILATE_SIZE = 3        # per-bucket mask dilation (NxN MaxFilter). 3 grows each color by 1 px so
                            # adjacent buckets overlap and the potrace-smoothed boundaries can't
                            # leave transparent slivers between neighboring fills or against the
                            # outline layer.


@app.get("/health")
def health():
    return {"ok": True}


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
) -> bytes:
    _log(
        f"trace_png start bytes={len(png_bytes)} size={size} colors={num_colors} "
        f"palette={palette} extract_outline_override={extract_outline_override}"
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    _log(f"trace_png opened {img.size}")

    target = _target_px_from_size(size)
    if target is not None:
        img.thumbnail(target, Image.Resampling.LANCZOS)
        _log(f"trace_png resized to {img.size} target={target}")

    width, height = img.size
    total_px = width * height or 1

    hoop_mm = _hoop_mm_from_size(size)
    px_per_mm = (width / hoop_mm[0]) if (hoop_mm and hoop_mm[0] > 0) else (EMBROIDERY_DPI / 25.4)
    turdsize_px = max(MIN_TURDSIZE_PX, round(px_per_mm * px_per_mm))
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

    if extract_outline:
        outline_mask = luma.point(
            lambda p: 0 if p < OUTLINE_LUMA_MAX else 255, mode="L"
        )
        dark_mask = luma.point(
            lambda p: 255 if p < OUTLINE_LUMA_MAX else 0, mode="L"
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

    _log("trace_png quantize start")
    t0 = time.time()
    if palette:
        pal_img = _palette_image(palette)
        quantized = body_img.quantize(palette=pal_img, dither=Image.Dither.NONE)
        _log(f"trace_png quantize done in {time.time()-t0:.2f}s (AI palette, {len(palette)} colors)")
    else:
        quantized = _quantize(body_img, num_colors)
        _log(f"trace_png quantize done in {time.time()-t0:.2f}s (MEDIANCUT)")

    # Absorb single-pixel and sub-speck noise into the dominant adjacent color
    # BEFORE tracing so there are no holes to patch. Each pixel becomes the
    # most common palette index in its NxN neighborhood — genuine edges stay
    # sharp (interior pixels already match their neighbors), specks dissolve.
    mode_size = MODE_FILTER_SIZE_PHOTO if not extract_outline else MODE_FILTER_SIZE
    quantized = quantized.filter(ImageFilter.ModeFilter(size=mode_size))
    _log(f"trace_png mode_filter_size={mode_size}")
    palette = quantized.getpalette() or []
    used_indices = set(quantized.getdata())
    _log(f"trace_png mode-filter done, {len(used_indices)} palette buckets used")

    layer_fragments: list[str] = []
    for idx in sorted(used_indices):
        r, g, b = palette[idx * 3 : idx * 3 + 3]

        # Positive mask (bucket pixels = 255) for dilation, then flip for potrace
        # which traces black-on-white. Dilation overlaps adjacent buckets by 1 px
        # so potrace-smoothed boundaries can't leave transparent slivers between
        # neighboring colors. Subtract body_strip_mask so no body color ever
        # stitches on paper or the former-outline area — the outline layer
        # handles those pixels on its own.
        positive = quantized.point(lambda p, i=idx: 255 if p == i else 0, mode="L")
        positive = ImageChops.subtract(positive, body_strip_mask)
        dilated = positive.filter(ImageFilter.MaxFilter(size=MASK_DILATE_SIZE))
        dilated = ImageChops.subtract(dilated, body_strip_mask)
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

    t0 = time.time()
    svg_bytes = _trace_png(
        png_bytes,
        num_colors=colors,
        size=size,
        palette=palette,
        extract_outline_override=extract_outline_override,
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

# Embroidery (experimental, private)

API-only. Converts SVGs to embroidery files (PES/DST/etc.) via Inkscape + Ink/Stitch. Not linked from the site, no `page.tsx`, never meant to be public.

## Architecture

Two services, same repo:

```
src/app/embroidery/
  _lib/
    worker.ts            fetch wrappers for the Python worker (trace, convert)
    r2.ts                Cloudflare R2 client + uploadToR2(key, bytes, contentType)
    pipeline.ts          orchestrator: PNG + size → trace → AI-tag → convert → upload all to R2
    ai/
      client.ts          OpenAI client getter (reads OPENAI_API_KEY)
      prompts.ts         system prompt for the SVG tagger
      tag-svg.ts         sends traced SVG + source PNG to GPT-4o, applies skip decisions
  api/
    convert/route.ts     POST /embroidery/api/convert — raw SVG → zip (proxies to worker)
    generate/route.ts    POST /embroidery/api/generate — multipart (size + PNG) → R2 key

worker/                  separate Docker container (Python/FastAPI)
  Dockerfile             Debian + Inkscape + Ink/Stitch + potrace + pinned inkex + pinned pyembroidery
  main.py                GET /health, POST /trace (PNG → SVG), POST /convert (SVG → zip)
  requirements.txt
```

Next.js handles HTTP / auth / R2. The worker container has Inkscape + Ink/Stitch installed and shells out to them. In prod both run as separate Railway services on the private network.

> The site-wide JS challenge in `src/proxy.ts` is exempted for `/embroidery/*` so API calls aren't served the bot-challenge HTML. If this silo ever moves, update that exemption too.

## Running the worker locally

### 1. Start Docker Desktop

If any `docker` command errors with:

```
pipe/dockerDesktopWindowsEngine: The system cannot find the file specified
```

Docker Desktop isn't running. Launch it from the Start menu and wait for the whale icon in the system tray to stop animating.

### 2. Build

Run from the repo root — the Dockerfile references paths as `worker/…` because Railway builds with the repo as the build context.

```bash
docker build -t embroidery-worker -f worker/Dockerfile .
```

### 3. Run

```bash
docker run --rm -d --name embroidery-worker -p 8080:8080 embroidery-worker
```

Port mapping is `hostPort:containerPort`. The container always listens on 8080 internally. If 8080 is busy on the host (`Bind for 0.0.0.0:8080 failed: port is already allocated`), map to another host port, e.g. `-p 8088:8080`, and adjust the curl URL accordingly. To see what has 8080:

```powershell
netstat -ano | findstr :8080
```

### 4. Health check

```bash
curl http://localhost:8080/health
# {"ok":true}
```

### 5. Stop

```bash
docker stop embroidery-worker
```

## Status

- [x] Worker skeleton (FastAPI hello-world)
- [x] Next.js route stub (returns 501)
- [x] Next.js route proxies to worker via `WORKER_URL` (default `http://localhost:8080`)
- [x] Debian-based Dockerfile with Inkscape + Ink/Stitch v3.2.2 + pinned inkex + pinned pyembroidery fork
- [x] `POST /convert` produces a zip of 6 embroidery formats (DST, EXP, JEF, PES, VP3, XXX) + BMP preview + source SVG
- [x] Worker `POST /trace` (PNG → multi-color SVG via Pillow palette quantize + potrace per color layer)
- [x] Next.js `_lib/ai/` wires OpenAI GPT-4o (uses `OPENAI_API_KEY`). The source PNG is passed as an R2 public URL (constructed from `CLOUDFLARE_PUBLIC_URL`), not base64. The intended hoop size (e.g. `4x4`) is passed in the user prompt so the model can reason about physical stitch constraints.
- [x] LLM output is constrained to the real Ink/Stitch v3.2.2 parameter vocabulary (pulled from `lib/elements/fill_stitch.py`, `satin_column.py`, `stroke.py` — source is the ground truth). Per-path response shape: `{index, stitch_type, fill_params?, satin_params?, running_params?, notes}` with only known param keys allowed. See `_lib/ai/prompts.ts` for the enumerated schema and `_lib/ai/tag-svg.ts` for the typed keys.
- [x] Application layer (`applyTags`) currently implements **skip only** — paths tagged `skip` are removed from the SVG, everything else passes through untouched so inkstitch uses defaults. Research confirms fill/satin/running element classes do not pop GUI dialogs themselves, so the earlier hang when setting `inkstitch:angle` was likely slow compute at the extension-orchestration layer — revisit to unblock applying the richer param set the LLM is now emitting. Worker Dockerfile keeps `xvfb` + `xauth` as a safety net.
- [x] Next.js `POST /embroidery/api/generate` takes multipart (`size` + PNG `image`), runs the pipeline, and uploads every artifact to R2 at `embroidery/{sha256[:12]}_{size}/{input.png,traced.svg,tagged.svg,out.zip}`
- [x] R2 persistence — no more local `tmp/` writes
- [ ] Download helper / presigned-URL endpoint so callers can retrieve artifacts without the R2 console
- [ ] Async queue + email-on-done
- [ ] Auth gate (shared secret / signed link)
- [ ] Optional: resize BMP preview (currently full-size at 96 DPI, reference product uses ~60×60 thumbnail)
- [ ] Reduce output size: a full-avatar trace produces ~100 fill regions and ~3MB zip; AI needs better skip-aggressiveness or we need per-path size thresholds in the trace step
- [ ] Investigate why setting `inkstitch:angle` on paths blocks inkstitch on a dialog, so we can re-enable per-path angle / stitch-type tagging
- [ ] Open question: HUS and VIP not produced (pyembroidery has no writers for those formats — reference product likely used a commercial tool)

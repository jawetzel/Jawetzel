import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { requireAuth } from "../../_lib/auth";
import { publicUrlFor, uploadToR2 } from "@/lib/r2";
import {
  appendDemoImage,
  findDemoImageByHash,
} from "@/lib/users";
import type { DemoImage } from "@/types/user";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// Hard cap on stored image dimensions. The largest hoop we support is 8×8 at
// 500 DPI = 4000 px on the long side, but uploads commonly come in at 4500+ px
// and the worker's halo detection / Sobel passes allocate ~3× the pixel count
// in float32 — a 4500×4900 source pushed past Docker default memory limits and
// OOM-killed the worker. 2500 is well above the perceptual threshold for any
// supported hoop size (trace resizes again anyway) and keeps every downstream
// allocation comfortably bounded.
const MAX_DIMENSION = 2500;
const ALLOWED: Record<string, "png" | "jpg"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // Upload is per-user — the shared service key can't attribute to a user doc.
  if (!auth.userId) {
    return Response.json(
      { error: "Per-user session required for uploads" },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 },
    );
  }

  const image = form.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return Response.json(
      { error: "Missing required file: image" },
      { status: 400 },
    );
  }
  if (image.size > MAX_BYTES) {
    return Response.json(
      { error: `File too large. Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  const contentType = image.type as keyof typeof ALLOWED;
  const ext = ALLOWED[contentType];
  if (!ext) {
    return Response.json(
      { error: "Unsupported image type. PNG or JPEG only." },
      { status: 400 },
    );
  }

  const originalBytes = new Uint8Array(await image.arrayBuffer());

  // Shrink the source to fit MAX_DIMENSION on the long side before storing.
  // We only resize when oversized — small inputs are passed through bit-for-bit
  // so dedup (hash) and downstream behavior stay identical for normal-sized art.
  let bytes: Uint8Array;
  try {
    const pipeline = sharp(originalBytes);
    const meta = await pipeline.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      const resized = await pipeline
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toFormat(ext === "png" ? "png" : "jpeg")
        .toBuffer();
      bytes = new Uint8Array(resized);
    } else {
      bytes = originalBytes;
    }
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Couldn't read image: ${err.message}`
            : "Couldn't read image.",
      },
      { status: 400 },
    );
  }

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);

  // Dedup: same user + same bytes → return the existing entry without
  // re-uploading or re-recording. R2 PutObject on the same key would be
  // idempotent anyway, but skipping the network + Mongo write is nicer.
  const existing = await findDemoImageByHash(auth.userId, hash);
  if (existing) {
    return Response.json({ image: existing, deduped: true });
  }

  const normalizedType: "image/png" | "image/jpeg" =
    contentType === "image/png" ? "image/png" : "image/jpeg";
  const key = `embroidery/${auth.userId}/uploads/${hash}.${ext}`;
  await uploadToR2(key, bytes, normalizedType);

  const originalName =
    image instanceof File && image.name ? image.name : null;

  const record: DemoImage = {
    key,
    url: publicUrlFor(key),
    hash,
    contentType: normalizedType,
    // Size reflects what's actually stored — post-resize when the image was
    // shrunk, original bytes otherwise.
    size: bytes.byteLength,
    originalName,
    uploadedAt: new Date(),
  };
  await appendDemoImage(auth.userId, record);

  return Response.json({ image: record, deduped: false });
}

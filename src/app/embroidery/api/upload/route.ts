import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireAuth } from "../../_lib/auth";
import { publicUrlFor, uploadToR2 } from "../../_lib/r2";
import {
  appendDemoImage,
  findDemoImageByHash,
} from "@/lib/users";
import type { DemoImage } from "@/types/user";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
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

  const bytes = new Uint8Array(await image.arrayBuffer());
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
    size: image.size,
    originalName,
    uploadedAt: new Date(),
  };
  await appendDemoImage(auth.userId, record);

  return Response.json({ image: record, deduped: false });
}

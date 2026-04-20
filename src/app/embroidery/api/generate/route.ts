import { NextRequest } from "next/server";

import { requireAuth } from "../../_lib/auth";
import { runPipeline } from "../../_lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  const unauth = requireAuth(request);
  if (unauth) return unauth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 },
    );
  }

  const size = form.get("size");
  const image = form.get("image");
  const colorsRaw = form.get("colors");

  if (typeof size !== "string" || !size.trim()) {
    return Response.json(
      { error: "Missing required field: size" },
      { status: 400 },
    );
  }
  if (!(image instanceof Blob) || image.size === 0) {
    return Response.json(
      { error: "Missing required file: image" },
      { status: 400 },
    );
  }
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (image.type && !allowed.includes(image.type)) {
    return Response.json(
      { error: `Unsupported image type ${image.type}; expected PNG/JPEG/WEBP` },
      { status: 400 },
    );
  }

  let colors: number | undefined;
  if (typeof colorsRaw === "string" && colorsRaw.trim()) {
    const parsed = Number(colorsRaw);
    if (!Number.isFinite(parsed)) {
      return Response.json(
        { error: "colors must be a number between 2 and 16" },
        { status: 400 },
      );
    }
    colors = parsed;
  }

  const manufacturerRaw = form.get("manufacturer");
  const threadNumbersRaw = form.get("thread_numbers");
  const manufacturer =
    typeof manufacturerRaw === "string" && manufacturerRaw.trim()
      ? manufacturerRaw.trim()
      : undefined;
  const threadNumbers =
    typeof threadNumbersRaw === "string" && threadNumbersRaw.trim()
      ? threadNumbersRaw
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
      : undefined;

  const pngBytes = new Uint8Array(await image.arrayBuffer());

  try {
    const result = await runPipeline(pngBytes, size, colors, {
      manufacturer,
      threadNumbers,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

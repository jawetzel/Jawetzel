import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/app/embroidery/_lib/auth";
import {
  ALLOWED_SIZES,
  runPipeline,
  validateCustomerId,
  validateSize,
} from "@/app/embroidery/_lib/pipeline";
import { WorkerError } from "@/app/embroidery/_lib/worker";
import {
  computeQuota,
  MONTHLY_LIMIT,
  WINDOW_DAYS,
} from "@/app/embroidery/_lib/quota";
import { appendApiGeneration, getUserById } from "@/lib/users";
import { deleteCached, getCached, setCached } from "@/lib/cache";
import type { Generation } from "@/types/user";

export const runtime = "nodejs";
export const maxDuration = 900;

// Programmatic surface for the embroidery pipeline. Caller auths with their
// per-user API key (`pwsk_…`) and POSTs the image bytes directly — no
// upload-then-URL dance. We resolve the userId from the key, run the same
// pipeline as the in-app flow, and hand back only the URL of the resulting
// `out.zip`. Same one-concurrent-per-user lock and 3-per-window quota as the
// web flow, but accounted independently from `User.api_generations` so API
// usage doesn't share counters with UI usage.

const INFLIGHT_TTL_MS = 20 * 60 * 1000;
const inflightKey = (userId: string) => `embroidery:api-generate:${userId}`;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!auth.userId) {
    return Response.json(
      { error: "Per-user credential required (API key or session)" },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      {
        error:
          "Expected multipart/form-data body with `image` (file) and `size` (string).",
      },
      { status: 400 },
    );
  }

  const sizeRaw = form.get("size");
  const image = form.get("image");
  const manufacturerRaw = form.get("manufacturer");
  const threadNumbersRaw = form.get("thread_numbers");

  if (typeof sizeRaw !== "string" || !sizeRaw.trim()) {
    return Response.json(
      { error: "Missing required field: size" },
      { status: 400 },
    );
  }
  let size: string;
  try {
    size = validateSize(sizeRaw);
  } catch {
    return Response.json(
      {
        error: `Invalid size "${sizeRaw}". Allowed: ${ALLOWED_SIZES.join(", ")}`,
      },
      { status: 400 },
    );
  }

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
  if (image.type && !ALLOWED_TYPES.has(image.type)) {
    return Response.json(
      {
        error: `Unsupported image type ${image.type}; expected PNG or JPEG.`,
      },
      { status: 400 },
    );
  }

  const pngBytes = new Uint8Array(await image.arrayBuffer());
  const inputHash = createHash("sha256")
    .update(pngBytes)
    .digest("hex")
    .slice(0, 12);
  const inputName = image instanceof File && image.name ? image.name : null;

  const user = await getUserById(auth.userId);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Dedup against prior API runs, but only when no custom palette opts were
  // provided — different manufacturer / thread_numbers produce different
  // outputs from the same image, and we don't track those on the record.
  const hasCustomPalette = manufacturer !== undefined || threadNumbers !== undefined;
  if (!hasCustomPalette) {
    const existing = (user.api_generations ?? []).find(
      (g) => g.inputHash === inputHash && g.size === size,
    );
    if (existing) {
      return Response.json({ zipUrl: existing.zipUrl }, { status: 200 });
    }
  }

  const lockKey = inflightKey(auth.userId);
  if (getCached<boolean>(lockKey)) {
    return Response.json(
      {
        error:
          "You already have an API generation running. Wait for it to finish before submitting another.",
        inflight: true,
      },
      { status: 409 },
    );
  }

  const quota = computeQuota(user.api_generations ?? [], undefined, {
    unlimited: auth.role === "admin" || auth.role === "service",
  });
  if (quota.exceeded) {
    const resetAt = quota.nextResetAt!;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((resetAt.getTime() - Date.now()) / 1000),
    );
    return Response.json(
      {
        error: `You've used ${quota.used} of ${MONTHLY_LIMIT} API generations in the past ${WINDOW_DAYS} days.`,
        used: quota.used,
        limit: MONTHLY_LIMIT,
        resetAt: resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  setCached(lockKey, true, INFLIGHT_TTL_MS);

  try {
    let customerId: string;
    try {
      customerId = validateCustomerId(auth.userId);
    } catch {
      return Response.json(
        { error: "Invalid user id for pipeline" },
        { status: 500 },
      );
    }

    try {
      const result = await runPipeline(pngBytes, size, undefined, {
        customerId,
        manufacturer,
        threadNumbers,
      });

      const zipUrl = result.urls?.["out.zip"];
      if (!zipUrl) {
        return Response.json(
          { error: "Pipeline returned no zip artifact" },
          { status: 500 },
        );
      }

      const generation: Generation = {
        createdAt: new Date(),
        size,
        inputHash,
        inputName,
        zipUrl,
        previewUrl: result.urls?.["tagged.svg"] ?? null,
      };
      await appendApiGeneration(auth.userId, generation);

      return Response.json({ zipUrl }, { status: 200 });
    } catch (err) {
      if (err instanceof WorkerError && err.status === 503) {
        return Response.json(
          {
            error:
              "All worker slots busy. Retry after the Retry-After seconds.",
          },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  } finally {
    deleteCached(lockKey);
  }
}

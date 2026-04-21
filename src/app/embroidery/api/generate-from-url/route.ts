import type { NextRequest } from "next/server";

import { requireAuth } from "../../_lib/auth";
import {
  ALLOWED_SIZES,
  runPipeline,
  validateCustomerId,
  validateSize,
} from "../../_lib/pipeline";
import { WorkerError } from "../../_lib/worker";
import { appendGeneration, getUserById } from "@/lib/users";
import { sendEmbroideryGenerationEmail } from "@/lib/email";
import { computeQuota, MONTHLY_LIMIT, WINDOW_DAYS } from "../../_lib/quota";
import { deleteCached, getCached, setCached } from "@/lib/cache";
import type { Generation } from "@/types/user";

export const runtime = "nodejs";
export const maxDuration = 900;

// Lock TTL is longer than maxDuration so a request killed by the platform
// eventually ages the lock out instead of stranding the user.
const INFLIGHT_TTL_MS = 20 * 60 * 1000;
const inflightKey = (userId: string) => `embroidery:generate:${userId}`;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!auth.userId) {
    return Response.json(
      { error: "Per-user session required" },
      { status: 403 },
    );
  }

  let body: { url?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Expected JSON body with { url, size }" },
      { status: 400 },
    );
  }

  if (typeof body.url !== "string" || !body.url.trim()) {
    return Response.json(
      { error: "Missing required field: url" },
      { status: 400 },
    );
  }
  if (typeof body.size !== "string" || !body.size.trim()) {
    return Response.json(
      { error: "Missing required field: size" },
      { status: 400 },
    );
  }

  let size: string;
  try {
    size = validateSize(body.size);
  } catch {
    return Response.json(
      { error: `Invalid size "${body.size}". Allowed: ${ALLOWED_SIZES.join(", ")}` },
      { status: 400 },
    );
  }

  // The URL must match one of this user's uploaded demo images. Prevents
  // SSRF + cross-user reads — only fetches bytes we wrote for this user.
  const user = await getUserById(auth.userId);
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  const demo = user.demo_images?.find((i) => i.url === body.url);
  if (!demo) {
    return Response.json(
      { error: "URL is not in your uploads" },
      { status: 403 },
    );
  }

  // Dedup: same image + same size was already generated. Return the prior
  // result instead of rerunning the pipeline. Doesn't touch quota.
  const existing = (user.generations ?? []).find(
    (g) => g.inputHash === demo.hash && g.size === size,
  );
  if (existing) {
    return Response.json(
      { zipUrl: existing.zipUrl, generation: existing, deduped: true },
      { status: 200 },
    );
  }

  // In-flight semaphore: one concurrent generation per user. Prevents double-
  // submit (second tab, impatient clicks) from burning two pipeline runs.
  const lockKey = inflightKey(auth.userId);
  if (getCached<boolean>(lockKey)) {
    return Response.json(
      {
        error:
          "You already have a generation running. If you lost the page, don't worry — you'll get an email with your files when it's done, and it'll show up on this page.",
        inflight: true,
      },
      { status: 409 },
    );
  }

  const quota = computeQuota(user.generations ?? [], undefined, {
    unlimited: auth.role === "admin" || auth.role === "service",
  });
  if (quota.exceeded) {
    const resetAt = quota.nextResetAt!;
    const resetPretty = resetAt.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const retryAfterSec = Math.max(
      1,
      Math.ceil((resetAt.getTime() - Date.now()) / 1000),
    );
    return Response.json(
      {
        error: `You've used ${quota.used} of ${MONTHLY_LIMIT} generations in the past ${WINDOW_DAYS} days. Next slot opens ${resetPretty}.`,
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

  // Take the lock. Release in finally, regardless of success/failure.
  setCached(lockKey, true, INFLIGHT_TTL_MS);

  try {
    let pngBytes: Uint8Array;
    try {
      const res = await fetch(demo.url);
      if (!res.ok) {
        return Response.json(
          { error: `Failed to fetch image: ${res.status}` },
          { status: 502 },
        );
      }
      pngBytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Image fetch failed" },
        { status: 502 },
      );
    }

    // userId is a Mongo ObjectId (24 hex) — passes validateCustomerId.
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
        inputHash: demo.hash,
        inputName: demo.originalName,
        zipUrl,
        previewUrl: result.urls?.["tagged.svg"] ?? null,
      };
      await appendGeneration(auth.userId, generation);

      // Email is best-effort — don't fail the request if Brevo hiccups.
      try {
        await sendEmbroideryGenerationEmail(
          { email: user.email, name: user.name },
          zipUrl,
          size,
        );
      } catch (err) {
        console.error("[generate-from-url] email failed:", err);
      }

      return Response.json({ zipUrl, generation, result }, { status: 200 });
    } catch (err) {
      if (err instanceof WorkerError && err.status === 503) {
        return Response.json(
          { error: "All worker slots busy. Retry after the Retry-After seconds." },
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

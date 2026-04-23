import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { runRefreshEmbroiderySupplies } from "@/worker/jobs/refresh-embroidery-supplies";
import { VENDOR_NAMES } from "@/worker/jobs/compile-feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "EMBROIDERY_API_KEY");
  if (auth instanceof Response) return auth;

  // Only admins (via session) or the shared env-var key may trigger a run.
  if (auth.role !== "admin" && auth.role !== "service") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  // `?compile=1` runs the merge-and-upload step without re-hitting the live
  // vendor APIs. Handy when iterating on extractor logic or output shape —
  // skips ~3 min of vendor pulls and reuses the last R2 snapshots.
  const compileOnly = params.get("compile") === "1";
  // `?vendor=NAME` pulls just that one vendor (ignored when compile=1).
  // Must be one of the wired VENDOR_NAMES.
  const vendorParam = params.get("vendor");
  if (vendorParam && !VENDOR_NAMES.includes(vendorParam as never)) {
    return Response.json(
      {
        ok: false,
        error: `Invalid vendor '${vendorParam}'. Must be one of: ${VENDOR_NAMES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await runRefreshEmbroiderySupplies({
      skipPulls: compileOnly,
      onlyVendor: vendorParam ?? undefined,
    });
    if (result.status === "busy") {
      return Response.json(
        { ok: false, busy: true, durationMs: Date.now() - startedAt },
        { status: 409 },
      );
    }
    return Response.json({
      ok: true,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[refresh-embroidery-supplies] manual trigger failed:", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

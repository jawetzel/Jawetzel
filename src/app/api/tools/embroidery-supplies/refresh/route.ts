import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { runRefreshEmbroiderySupplies } from "@/worker/jobs/refresh-embroidery-supplies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "EMBROIDERY_API_KEY");
  if (auth instanceof Response) return auth;

  // Only admins (via session) or the shared env-var key may trigger a run.
  if (auth.role !== "admin" && auth.role !== "service") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const startedAt = Date.now();
  try {
    const result = await runRefreshEmbroiderySupplies();
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

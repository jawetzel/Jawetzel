import type { NextRequest } from "next/server";
import { requireAuth } from "@/app/embroidery/_lib/auth";
import { loadPalette } from "@/app/embroidery/_lib/inkstitch/gpl-palette";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ manufacturer: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { manufacturer } = await params;
  try {
    const threads = loadPalette(manufacturer);
    return Response.json({
      manufacturer,
      count: threads.length,
      threads,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 404 });
  }
}

import type { NextRequest } from "next/server";
import { requireAuth } from "@/app/embroidery/_lib/auth";
import { ALLOWED_SIZES } from "@/app/embroidery/_lib/pipeline";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  return Response.json({ sizes: [...ALLOWED_SIZES] });
}

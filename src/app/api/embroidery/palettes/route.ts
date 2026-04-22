import type { NextRequest } from "next/server";
import { requireAuth } from "@/app/embroidery/_lib/auth";
import {
  DEFAULT_MANUFACTURER,
  listManufacturers,
} from "@/app/embroidery/_lib/inkstitch/gpl-palette";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  return Response.json({
    default: DEFAULT_MANUFACTURER,
    manufacturers: listManufacturers(),
  });
}

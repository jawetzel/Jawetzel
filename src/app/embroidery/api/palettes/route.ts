import { requireAuth } from "../../_lib/auth";
import { listManufacturers, DEFAULT_MANUFACTURER } from "../../_lib/inkstitch/gpl-palette";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  return Response.json({
    default: DEFAULT_MANUFACTURER,
    manufacturers: listManufacturers(),
  });
}

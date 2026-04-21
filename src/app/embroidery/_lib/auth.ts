import { requireAuth as requireAuthBase, type AuthPrincipal } from "@/lib/api-auth";

export type { AuthPrincipal };

// Embroidery-surface binding: the shared-key path reads EMBROIDERY_API_KEY.
// Per-surface keys keep blast radius small — a leaked key unlocks only this
// surface, not other gated endpoints.
export function requireAuth(request: Request) {
  return requireAuthBase(request, "EMBROIDERY_API_KEY");
}

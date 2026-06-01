/**
 * AuthPrincipal — the resolved identity of an authenticated request.
 *
 * A pure domain type with zero I/O. A gated endpoint accepts one of three
 * actors (signed-in browser user, a user's `pwsk_` API key, or a shared
 * server-to-server key) and they all collapse to this shape. The shared-key
 * path has no `userId` and carries the synthetic `"service"` role — a caller
 * that needs a *user* must reject `role: "service"` itself.
 *
 * See `docs/architecture/auth.md` for the three-actor model.
 */
export type AuthPrincipal = {
  userId: string | null;
  role: "user" | "admin" | "service";
};

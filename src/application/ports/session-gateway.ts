/**
 * SessionGateway — a driven port for resolving the current browser session to
 * a principal.
 *
 * Consumer-owned: `AuthenticateRequest` needs only `getCurrentPrincipal`, which
 * returns the signed-in user's `{ userId, role }` or `null` when no session is
 * present. This is the seam that puts NextAuth *fully* behind the boundary —
 * the use-case no longer knows about `next-auth`, cookies, or the JWT verify.
 *
 * The production adapter (`NextAuthSessionGateway`) wraps `getCachedSession()`,
 * which short-circuits to null with no work when no cookie is present and
 * otherwise caches the decoded `Session` for 10 minutes keyed on the cookie.
 * See `docs/architecture/auth.md` → Sessions.
 */
export interface SessionPrincipal {
  userId: string;
  role: "user" | "admin";
}

export interface SessionGateway {
  /** Resolve the current session to a principal, or null if not signed in. */
  getCurrentPrincipal(): Promise<SessionPrincipal | null>;
}

import { getCachedSession } from "@/lib/auth";
import {
  type SessionGateway,
  type SessionPrincipal,
} from "@/application/ports/session-gateway";

/**
 * NextAuthSessionGateway — the production {@link SessionGateway}.
 *
 * Wraps `getCachedSession()` (which stays in `src/lib/auth.ts`): it
 * short-circuits to null when no session cookie is present (zero work) and
 * otherwise caches the decoded NextAuth `Session` for 10 minutes keyed on the
 * cookie. This adapter just calls it and maps a present session to a principal,
 * returning null when there is no signed-in user. NextAuth lives entirely
 * behind this seam — no use-case imports `next-auth`. See
 * `docs/architecture/auth.md` → Sessions.
 */
export class NextAuthSessionGateway implements SessionGateway {
  async getCurrentPrincipal(): Promise<SessionPrincipal | null> {
    const session = await getCachedSession();
    if (session?.user?.id) {
      return { userId: session.user.id, role: session.user.role };
    }
    return null;
  }
}

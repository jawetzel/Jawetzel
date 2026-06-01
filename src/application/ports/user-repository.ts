/**
 * UserRepository — a driven port for user persistence.
 *
 * Consumer-owned and intentionally minimal, widened method-by-method as
 * user use-cases migrate (never speculatively):
 *   - `findOrCreateByEmail` — `ConsumeMagicLink`.
 *   - `findOrCreateGoogleUser` — `FindOrCreateGoogleUser` (Google sign-in).
 *   - `getApiKeyHash` / `setApiKeyHash` — `IssueApiKey` (read the previous hash
 *     to evict on rotate; persist the new hash, never the plaintext).
 * The production adapter is `MongoUserRepository`.
 *
 * `AuthUser` is the slim identity DTO use-cases speak — not the full Mongo
 * `User` document, which never crosses the use-case boundary.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

/** Identity fields a Google OAuth sign-in carries through to provisioning. */
export interface GoogleUserInput {
  googleId: string;
  email: string;
  name: string;
  image: string | null;
}

export interface UserRepository {
  /** Find the user with this email, creating a magic-link-only one if absent. */
  findOrCreateByEmail(email: string): Promise<AuthUser>;
  /**
   * Provision (or reconcile) the user behind a Google OAuth identity: match on
   * googleId, else on email (attaching the googleId), else insert a new user.
   */
  findOrCreateGoogleUser(input: GoogleUserInput): Promise<AuthUser>;
  /** The user's current stored API-key hash, or null if none is set. */
  getApiKeyHash(userId: string): Promise<string | null>;
  /** Persist the user's API-key hash (the HMAC, never the plaintext). */
  setApiKeyHash(userId: string, hash: string): Promise<void>;
}

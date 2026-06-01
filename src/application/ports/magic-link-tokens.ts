/**
 * MagicLinkTokens — a driven port for the magic-link token lifecycle.
 *
 * Consumer-owned: `RequestMagicLink` needs `issue`, `ConsumeMagicLink` needs
 * `consume`, and nothing else. Single-use is part of the contract: `consume`
 * invalidates the token as it reads it, so a second call for the same token
 * returns null. The production adapter is the in-process cache
 * (`InProcessMagicLinkTokens`); a Redis/Mongo-backed adapter would lift the
 * single-instance limitation noted in `docs/architecture/auth.md` without
 * touching either use-case.
 */
export interface MagicLinkTokens {
  /** Mint a single-use token bound to `email`, store it, return the token. */
  issue(email: string): Promise<string>;
  /**
   * Validate and consume a token. Returns the bound email and invalidates the
   * token (single-use), or null if the token is unknown/expired/already used.
   */
  consume(token: string): Promise<string | null>;
}

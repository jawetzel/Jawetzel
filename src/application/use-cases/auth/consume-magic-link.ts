import { type MagicLinkTokens } from "@/application/ports/magic-link-tokens";
import { type UserRepository } from "@/application/ports/user-repository";

/**
 * ConsumeMagicLink — validate a magic-link token and resolve it to a sign-in
 * principal, materializing the user on first use. Single-use is enforced by the
 * token port. Returns null for any unusable token (unknown, expired, already
 * used) so the caller (NextAuth's `authorize`) can collapse every failure into
 * the same "no" without leaking which case occurred.
 */
export interface MagicLinkPrincipal {
  userId: string;
  email: string;
  role: "user" | "admin";
}

export interface ConsumeMagicLinkDeps {
  tokens: MagicLinkTokens;
  users: UserRepository;
}

export interface ConsumeMagicLink {
  execute(token: string): Promise<MagicLinkPrincipal | null>;
}

export function createConsumeMagicLink(
  deps: ConsumeMagicLinkDeps,
): ConsumeMagicLink {
  const { tokens, users } = deps;

  return {
    async execute(token) {
      const email = await tokens.consume(token);
      if (!email) return null;

      const user = await users.findOrCreateByEmail(email);
      return { userId: user.id, email: user.email, role: user.role };
    },
  };
}

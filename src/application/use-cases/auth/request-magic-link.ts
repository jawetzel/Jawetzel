import { type MagicLinkTokens } from "@/application/ports/magic-link-tokens";
import { type EmailSender } from "@/application/ports/email-sender";
import { buildMagicLinkEmail } from "./auth-emails";

/**
 * RequestMagicLink — mint a single-use sign-in token for an email and send the
 * link. No user record is created here; the account is materialized only when
 * the link is consumed (see `ConsumeMagicLink`), so this endpoint can't be
 * abused to spam-create accounts.
 *
 * Orchestration only: depends on the {@link MagicLinkTokens} and
 * {@link EmailSender} ports plus an injected `baseUrl`. A send failure throws —
 * the driving adapter swallows and logs it so the HTTP response never reveals
 * whether the address was known (anti-enumeration), preserving prior behavior.
 */
export interface RequestMagicLinkInput {
  email: string;
  callbackUrl?: string;
}

export interface RequestMagicLinkDeps {
  tokens: MagicLinkTokens;
  email: EmailSender;
  /** Site origin for the verify link; injected by composition. */
  baseUrl: string;
}

export interface RequestMagicLink {
  execute(input: RequestMagicLinkInput): Promise<void>;
}

export function createRequestMagicLink(
  deps: RequestMagicLinkDeps,
): RequestMagicLink {
  const { tokens, email, baseUrl } = deps;

  return {
    async execute({ email: rawEmail, callbackUrl }) {
      const normalized = rawEmail.toLowerCase().trim();
      const token = await tokens.issue(normalized);
      await email.send(
        buildMagicLinkEmail(normalized, token, baseUrl, callbackUrl),
      );
    },
  };
}

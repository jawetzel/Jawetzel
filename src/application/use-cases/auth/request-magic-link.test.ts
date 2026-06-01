import { describe, it, expect } from "vitest";
import {
  type EmailSender,
  type EmailMessage,
} from "@/application/ports/email-sender";
import { type MagicLinkTokens } from "@/application/ports/magic-link-tokens";
import { createRequestMagicLink } from "./request-magic-link";

class FakeMagicLinkTokens implements MagicLinkTokens {
  readonly issued: string[] = [];
  token = "tok_fixed_123";
  async issue(email: string): Promise<string> {
    this.issued.push(email);
    return this.token;
  }
  async consume(): Promise<string | null> {
    return null;
  }
}

class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

const BASE = "https://jawetzel.com/";

function make() {
  const tokens = new FakeMagicLinkTokens();
  const email = new FakeEmailSender();
  const useCase = createRequestMagicLink({ tokens, email, baseUrl: BASE });
  return { tokens, email, useCase };
}

describe("RequestMagicLink", () => {
  it("normalizes the email, mints a token, and sends the link", async () => {
    const { tokens, email, useCase } = make();
    await useCase.execute({ email: "  Ada@Example.COM ", callbackUrl: "/account" });

    // normalized before minting + sending
    expect(tokens.issued).toEqual(["ada@example.com"]);
    expect(email.sent).toHaveLength(1);

    const msg = email.sent[0];
    expect(msg.to[0].email).toBe("ada@example.com");
    expect(msg.subject).toBe("Sign in to jawetzel.com");
    // trailing slash on base is stripped; token + encoded callback present
    expect(msg.html).toContain(
      "https://jawetzel.com/auth/verify?token=tok_fixed_123",
    );
    expect(msg.html).toContain("callbackUrl=%2Faccount");
  });

  it("omits the callbackUrl param when none is given", async () => {
    const { email, useCase } = make();
    await useCase.execute({ email: "ada@example.com" });

    const msg = email.sent[0];
    expect(msg.html).toContain(
      "https://jawetzel.com/auth/verify?token=tok_fixed_123",
    );
    expect(msg.html).not.toContain("callbackUrl=");
  });
});

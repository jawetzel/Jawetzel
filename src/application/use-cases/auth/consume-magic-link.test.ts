import { describe, it, expect } from "vitest";
import { type MagicLinkTokens } from "@/application/ports/magic-link-tokens";
import {
  type UserRepository,
  type AuthUser,
} from "@/application/ports/user-repository";
import { createConsumeMagicLink } from "./consume-magic-link";

class FakeMagicLinkTokens implements MagicLinkTokens {
  constructor(private readonly result: string | null) {}
  consumed: string[] = [];
  async issue(): Promise<string> {
    return "unused";
  }
  async consume(token: string): Promise<string | null> {
    this.consumed.push(token);
    return this.result;
  }
}

class FakeUserRepository implements UserRepository {
  calls = 0;
  async findOrCreateByEmail(email: string): Promise<AuthUser> {
    this.calls++;
    return { id: "user_1", email, role: "user" };
  }
  // ConsumeMagicLink only calls `findOrCreateByEmail`; the Google-provisioning
  // and API-key hash methods exist on the port for other use-cases and are
  // unused here.
  async findOrCreateGoogleUser(): Promise<AuthUser> {
    return { id: "user_1", email: "unused@example.com", role: "user" };
  }
  async getApiKeyHash(): Promise<string | null> {
    return null;
  }
  async setApiKeyHash(): Promise<void> {}
}

describe("ConsumeMagicLink", () => {
  it("resolves a valid token to a sign-in principal", async () => {
    const tokens = new FakeMagicLinkTokens("ada@example.com");
    const users = new FakeUserRepository();
    const principal = await createConsumeMagicLink({ tokens, users }).execute(
      "tok",
    );

    expect(principal).toEqual({
      userId: "user_1",
      email: "ada@example.com",
      role: "user",
    });
    expect(tokens.consumed).toEqual(["tok"]);
  });

  it("returns null for an unusable token and never touches the user store", async () => {
    const tokens = new FakeMagicLinkTokens(null);
    const users = new FakeUserRepository();
    const principal = await createConsumeMagicLink({ tokens, users }).execute(
      "bad",
    );

    expect(principal).toBeNull();
    expect(users.calls).toBe(0);
  });
});

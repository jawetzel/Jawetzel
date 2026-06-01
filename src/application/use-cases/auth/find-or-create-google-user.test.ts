import { describe, it, expect } from "vitest";
import {
  type UserRepository,
  type AuthUser,
  type GoogleUserInput,
} from "@/application/ports/user-repository";
import { createFindOrCreateGoogleUser } from "./find-or-create-google-user";

/**
 * The repository owns the match-googleId / match-email / insert provisioning
 * rules; the use-case is the thin policy seam over it. This fake records the
 * input it was handed and yields a deterministic `AuthUser`, so the test asserts
 * the use-case (a) passes the Google identity through verbatim and (b) returns
 * exactly the slim DTO the repo produced — nothing reshaped.
 */
class FakeUserRepository implements UserRepository {
  googleCalls: GoogleUserInput[] = [];

  constructor(private readonly result: AuthUser) {}

  async findOrCreateByEmail(email: string): Promise<AuthUser> {
    return { id: "unused", email, role: "user" };
  }
  async findOrCreateGoogleUser(input: GoogleUserInput): Promise<AuthUser> {
    this.googleCalls.push(input);
    return this.result;
  }
  async getApiKeyHash(): Promise<string | null> {
    return null;
  }
  async setApiKeyHash(): Promise<void> {}
}

describe("FindOrCreateGoogleUser", () => {
  it("returns the AuthUser the repository yields", async () => {
    const users = new FakeUserRepository({
      id: "user_42",
      email: "ada@example.com",
      role: "admin",
    });

    const result = await createFindOrCreateGoogleUser({ users }).execute({
      googleId: "g-123",
      email: "ada@example.com",
      name: "Ada Lovelace",
      image: null,
    });

    expect(result).toEqual({
      id: "user_42",
      email: "ada@example.com",
      role: "admin",
    });
  });

  it("passes the Google identity through to the repository verbatim", async () => {
    const users = new FakeUserRepository({
      id: "user_1",
      email: "grace@example.com",
      role: "user",
    });

    const input: GoogleUserInput = {
      googleId: "g-999",
      email: "grace@example.com",
      name: "Grace Hopper",
      image: "https://example.com/avatar.png",
    };
    await createFindOrCreateGoogleUser({ users }).execute(input);

    expect(users.googleCalls).toEqual([input]);
  });
});

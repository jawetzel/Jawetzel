import { describe, it, expect } from "vitest";
import { isOk, isErr } from "@/domain/shared/result";
import {
  type SessionGateway,
  type SessionPrincipal,
} from "@/application/ports/session-gateway";
import {
  type ApiKeyVerifier,
  type VerifiedApiKeyPrincipal,
} from "@/application/ports/api-key-verifier";
import { type ServiceKeyVerifier } from "@/application/ports/service-key-verifier";
import { createAuthenticateRequest } from "./authenticate-request";

class FakeSession implements SessionGateway {
  constructor(private readonly principal: SessionPrincipal | null) {}
  async getCurrentPrincipal(): Promise<SessionPrincipal | null> {
    return this.principal;
  }
}

class FakeApiKey implements ApiKeyVerifier {
  verified: string[] = [];
  constructor(private readonly principal: VerifiedApiKeyPrincipal | null) {}
  async verify(providedKey: string): Promise<VerifiedApiKeyPrincipal | null> {
    this.verified.push(providedKey);
    return this.principal;
  }
  // AuthenticateRequest only calls `verify`; `hash`/`evict` exist on the port
  // for the issuer (IssueApiKey) and are unused here.
  hash(plaintext: string): string {
    return `hash(${plaintext})`;
  }
  evict(): void {}
}

class FakeServiceKey implements ServiceKeyVerifier {
  matchedWith: Array<{ key: string; env: string }> = [];
  constructor(private readonly result: boolean) {}
  matches(providedKey: string, apiKeyEnvVar: string): boolean {
    this.matchedWith.push({ key: providedKey, env: apiKeyEnvVar });
    return this.result;
  }
}

const ENV = "EMBROIDERY_API_KEY";

describe("AuthenticateRequest", () => {
  it("path 1: a present session resolves to its principal", async () => {
    const session = new FakeSession({ userId: "u_1", role: "admin" });
    const apiKey = new FakeApiKey(null);
    const serviceKey = new FakeServiceKey(false);
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    const result = await uc.execute({ providedKey: "", apiKeyEnvVar: ENV });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ userId: "u_1", role: "admin" });
    }
    // Session wins outright — neither key path is consulted.
    expect(apiKey.verified).toEqual([]);
    expect(serviceKey.matchedWith).toEqual([]);
  });

  it("order: session wins even when a valid pwsk_ key is also present", async () => {
    const session = new FakeSession({ userId: "u_session", role: "user" });
    const apiKey = new FakeApiKey({ userId: "u_key", role: "admin" });
    const serviceKey = new FakeServiceKey(true);
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    const result = await uc.execute({
      providedKey: "pwsk_abc",
      apiKeyEnvVar: ENV,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ userId: "u_session", role: "user" });
    }
    expect(apiKey.verified).toEqual([]);
    expect(serviceKey.matchedWith).toEqual([]);
  });

  it("path 2: no session + a valid pwsk_ key resolves to the user principal", async () => {
    const session = new FakeSession(null);
    const apiKey = new FakeApiKey({ userId: "u_42", role: "user" });
    const serviceKey = new FakeServiceKey(true);
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    const result = await uc.execute({
      providedKey: "pwsk_live",
      apiKeyEnvVar: ENV,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ userId: "u_42", role: "user" });
    }
    expect(apiKey.verified).toEqual(["pwsk_live"]);
    // Service path never reached when the pwsk_ key succeeds.
    expect(serviceKey.matchedWith).toEqual([]);
  });

  it("path 2 miss: a failing pwsk_ key is UNAUTHORIZED and does NOT fall through to service", async () => {
    const session = new FakeSession(null);
    const apiKey = new FakeApiKey(null); // resolves to no user
    const serviceKey = new FakeServiceKey(true); // would match if reached
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    const result = await uc.execute({
      providedKey: "pwsk_bad",
      apiKeyEnvVar: ENV,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBe("UNAUTHORIZED");
    expect(apiKey.verified).toEqual(["pwsk_bad"]);
    // Critical security invariant: the service verifier is NOT consulted.
    expect(serviceKey.matchedWith).toEqual([]);
  });

  it("path 3: no session + non-pwsk_ key matching the env secret resolves to service (userId null)", async () => {
    const session = new FakeSession(null);
    const apiKey = new FakeApiKey({ userId: "should_not", role: "admin" });
    const serviceKey = new FakeServiceKey(true);
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    const result = await uc.execute({
      providedKey: "shared-secret",
      apiKeyEnvVar: ENV,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ userId: null, role: "service" });
    }
    // The pwsk_ discriminator means a non-prefixed key never hits the DB.
    expect(apiKey.verified).toEqual([]);
    expect(serviceKey.matchedWith).toEqual([
      { key: "shared-secret", env: ENV },
    ]);
  });

  it("nothing: no session, no usable key -> UNAUTHORIZED", async () => {
    const session = new FakeSession(null);
    const apiKey = new FakeApiKey(null);
    const serviceKey = new FakeServiceKey(false);
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    const result = await uc.execute({ providedKey: "", apiKeyEnvVar: ENV });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBe("UNAUTHORIZED");
    // Empty (non-pwsk_) key skips the DB and is handed to the service verifier.
    expect(apiKey.verified).toEqual([]);
    expect(serviceKey.matchedWith).toEqual([{ key: "", env: ENV }]);
  });

  it("passes the surface env-var name through to the service verifier", async () => {
    const session = new FakeSession(null);
    const apiKey = new FakeApiKey(null);
    const serviceKey = new FakeServiceKey(false);
    const uc = createAuthenticateRequest({ session, apiKey, serviceKey });

    await uc.execute({ providedKey: "x", apiKeyEnvVar: "SMS_API_KEY" });

    expect(serviceKey.matchedWith).toEqual([{ key: "x", env: "SMS_API_KEY" }]);
  });
});

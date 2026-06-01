import { describe, it, expect, afterEach } from "vitest";
import { ServiceKeyVerifierAdapter } from "./service-key-verifier-adapter";

const ENV = "TEST_SHARED_KEY_ABC";

describe("ServiceKeyVerifierAdapter", () => {
  afterEach(() => {
    delete process.env[ENV];
  });

  it("matches when the env secret is set and equals the provided key", () => {
    process.env[ENV] = "s3cret-value";
    const adapter = new ServiceKeyVerifierAdapter();
    expect(adapter.matches("s3cret-value", ENV)).toBe(true);
  });

  it("does not match a different provided key", () => {
    process.env[ENV] = "s3cret-value";
    const adapter = new ServiceKeyVerifierAdapter();
    expect(adapter.matches("wrong", ENV)).toBe(false);
  });

  it("does not match when the env var is unset (no secret configured)", () => {
    const adapter = new ServiceKeyVerifierAdapter();
    expect(adapter.matches("anything", ENV)).toBe(false);
  });

  it("does not match an empty provided key even if the env secret is empty", () => {
    // Guard: empty provided key must never authenticate. An empty env value is
    // falsy too, so this can't accidentally pass.
    process.env[ENV] = "";
    const adapter = new ServiceKeyVerifierAdapter();
    expect(adapter.matches("", ENV)).toBe(false);
  });

  it("does not match an empty provided key against a real secret", () => {
    process.env[ENV] = "s3cret-value";
    const adapter = new ServiceKeyVerifierAdapter();
    expect(adapter.matches("", ENV)).toBe(false);
  });
});

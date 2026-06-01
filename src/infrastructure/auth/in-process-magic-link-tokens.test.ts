import { describe, it, expect } from "vitest";
import { InProcessMagicLinkTokens } from "./in-process-magic-link-tokens";
import { FakeCache } from "@/application/ports/cache.fake";

/**
 * Runs against an injected in-memory fake Cache (no globalThis bleed, no
 * external I/O) — verifies the round-trip and the single-use guarantee that the
 * magic-link security model depends on. The single-use property rests on the
 * Cache port's synchronous read-then-delete, so a sync fake exercises the exact
 * contract the production `MemTtlCache` upholds.
 */
describe("InProcessMagicLinkTokens", () => {
  it("issues a token that consumes back to the bound email exactly once", async () => {
    const tokens = new InProcessMagicLinkTokens({ cache: new FakeCache() });
    const token = await tokens.issue("ada@example.com");

    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
    expect(await tokens.consume(token)).toBe("ada@example.com");
    // single-use: a second consume of the same token fails
    expect(await tokens.consume(token)).toBeNull();
  });

  it("returns null for unknown and empty tokens", async () => {
    const tokens = new InProcessMagicLinkTokens({ cache: new FakeCache() });
    expect(await tokens.consume("never-issued")).toBeNull();
    expect(await tokens.consume("")).toBeNull();
  });
});

import crypto from "node:crypto";
import { type Cache } from "@/application/ports/cache";
import { type MagicLinkTokens } from "@/application/ports/magic-link-tokens";

/**
 * InProcessMagicLinkTokens — the production {@link MagicLinkTokens}, backed by
 * the in-process TTL cache. Nothing hits the database at issue-time, so the
 * send endpoint can't be used to spam-create accounts; the link simply lives in
 * memory for 30 minutes.
 *
 * **Single-instance only** — a server restart or a second replica loses pending
 * links (treated as expired). Acceptable on the current single Railway replica;
 * swap in a shared-store adapter to lift it. See `docs/architecture/auth.md`.
 */
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const KEY_PREFIX = "magic-link:";

interface PendingLink {
  email: string;
}

export class InProcessMagicLinkTokens implements MagicLinkTokens {
  constructor(private readonly deps: { cache: Cache }) {}

  async issue(email: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex");
    this.deps.cache.set<PendingLink>(KEY_PREFIX + token, { email }, TTL_MS);
    return token;
  }

  async consume(token: string): Promise<string | null> {
    if (!token || typeof token !== "string") return null;
    const key = KEY_PREFIX + token;
    const pending = this.deps.cache.get<PendingLink>(key);
    if (!pending) return null;
    // Single-use: delete synchronously before returning. The Cache port's
    // `get` and `delete` are synchronous by contract, so this method's body
    // runs atomically w.r.t. the event loop — two concurrent consumes can't
    // both see the entry.
    this.deps.cache.delete(key);
    return pending.email;
  }
}

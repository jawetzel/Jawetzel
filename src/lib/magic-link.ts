import crypto from "node:crypto";
import { getCached, setCached, deleteCached } from "./cache";
import { findOrCreateByEmail } from "./users";
import { sendMagicLinkEmail } from "./email";

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const KEY_PREFIX = "magic-link:";

export type MagicLinkResult =
  | { valid: true; userId: string; email: string; role: "user" | "admin" }
  | { valid: false };

interface PendingLink {
  email: string;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Send a magic link to `email`. The pending link lives in the in-process
 * memory cache (TTL 30 min) — nothing is written to the database, so the
 * send endpoint cannot be abused to spam-create user accounts. The user
 * record is materialized only at consume-time, after the recipient proves
 * control of the address by clicking the link.
 *
 * If the server restarts before the user clicks, the link is gone — the
 * verify page treats that the same as an expired link.
 *
 * Always resolves so the response shape never reveals whether the email
 * was already known.
 */
export async function sendMagicLink(
  email: string,
  callbackUrl?: string,
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const token = generateToken();
  setCached<PendingLink>(
    KEY_PREFIX + token,
    { email: normalizedEmail },
    TTL_MS,
  );
  await sendMagicLinkEmail(normalizedEmail, token, callbackUrl);
}

/**
 * Validate AND consume a magic-link token. Single-use is enforced by
 * deleting the cache entry before any await — JS single-threading means
 * a concurrent consume cannot observe the entry between read and delete.
 */
export async function consumeMagicLinkToken(
  token: string,
): Promise<MagicLinkResult> {
  if (!token || typeof token !== "string") return { valid: false };
  const key = KEY_PREFIX + token;
  const pending = getCached<PendingLink>(key);
  if (!pending) return { valid: false };
  // Single-use: delete synchronously before any await. Used, expired,
  // wiped-by-restart, never-existed all collapse into the same {valid:false}
  // path so the verify UI never reveals which one happened.
  deleteCached(key);

  const user = await findOrCreateByEmail({ email: pending.email });
  return {
    valid: true,
    userId: user._id!.toString(),
    email: user.email,
    role: user.role,
  };
}

"use server";

import { randomUUID } from "node:crypto";
import { evictCachedApiKey, hashApiKey } from "@/lib/api-auth";
import { getCachedSession } from "@/lib/auth";
import { getUserById, setApiKeyHash } from "@/lib/users";

function newKey(): string {
  return `pwsk_${randomUUID()}`;
}

async function requireUserId(): Promise<string> {
  const session = await getCachedSession();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

// Issues a new key, replaces any existing one. Plaintext is returned to the
// caller (shown once); only the HMAC is persisted, so the key is unrecoverable
// after this response. On rotate we evict the old hash from the api-key cache
// so it stops authenticating within seconds, not after the 20-min TTL.
export async function issueApiKeyAction(): Promise<{ apiKey: string }> {
  const userId = await requireUserId();
  const previous = await getUserById(userId);

  const apiKey = newKey();
  await setApiKeyHash(userId, hashApiKey(apiKey));

  if (previous?.apiKeyHash) {
    evictCachedApiKey(previous.apiKeyHash);
  }
  return { apiKey };
}

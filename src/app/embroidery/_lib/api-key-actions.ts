"use server";

import { createContainer } from "@/composition/container";
import { getCachedSession } from "@/lib/auth";

// Edge session auth, preserved verbatim from the pre-migration action: resolve
// the signed-in user from the NextAuth session, throwing (not a Response) on no
// session so `ApiKeyPanel`'s try/catch surfaces the message unchanged.
async function requireUserId(): Promise<string> {
  const session = await getCachedSession();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

// Thin "use server" driving adapter. Parses the actor (session auth above),
// then delegates to the `IssueApiKey` use-case, which generates the
// `pwsk_<uuid>`, persists only its HMAC, and evicts any previous hash on rotate
// so the old key stops authenticating within seconds. Returns the plaintext —
// shown once, unrecoverable after — so `ApiKeyPanel.tsx` is untouched.
export async function issueApiKeyAction(): Promise<{ apiKey: string }> {
  const userId = await requireUserId();
  return createContainer().issueApiKey.execute({ userId });
}

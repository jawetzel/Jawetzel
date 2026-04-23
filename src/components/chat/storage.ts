/** Browser-side persistence for chat state that survives navigation.
 *  Two keys:
 *    chat:open       — "1" if the drawer is open, absent otherwise
 *    chat:convo-id   — the ObjectId of the currently-active thread
 *                      (set for both anon and authed — it's whatever
 *                      conversation the user is continuing). Cleared on
 *                      "new conversation" and on a 404 from the server. */

const KEY_OPEN = "chat:open";
const KEY_CONVO = "chat:convo-id";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function readOpen(): boolean {
  if (!hasStorage()) return false;
  return window.localStorage.getItem(KEY_OPEN) === "1";
}

export function writeOpen(open: boolean): void {
  if (!hasStorage()) return;
  if (open) window.localStorage.setItem(KEY_OPEN, "1");
  else window.localStorage.removeItem(KEY_OPEN);
}

export function readConvoId(): string | null {
  if (!hasStorage()) return null;
  return window.localStorage.getItem(KEY_CONVO);
}

export function writeConvoId(id: string | null): void {
  if (!hasStorage()) return;
  if (id) window.localStorage.setItem(KEY_CONVO, id);
  else window.localStorage.removeItem(KEY_CONVO);
}

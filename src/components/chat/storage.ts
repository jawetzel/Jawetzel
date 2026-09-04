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

/* `chat:open` is read through `useSyncExternalStore`, which is what lets the
   drawer render closed on the server and adopt the stored value on hydration
   without an after-mount effect (and therefore without the extra render pass an
   effect costs). That needs a subscribe/notify pair, below.

   Deliberately in-page only: no `window.addEventListener("storage", …)`. Cross-
   tab propagation would be free here, but opening the assistant in one tab
   silently opening it in another is a behavior nobody asked for. */
const openListeners = new Set<() => void>();

export function subscribeOpen(onChange: () => void): () => void {
  openListeners.add(onChange);
  return () => {
    openListeners.delete(onChange);
  };
}

/* In-memory fallback for when localStorage is unavailable — Safari private
   mode, or storage blocked in an embedded context. This matters now that the
   launcher reads its open state through this module instead of holding it in
   component state: without it, `writeOpen` would no-op in those browsers and
   the chat button would be inert rather than merely non-persistent. Only ever
   read in the browser (the server path returns early), so it is not shared
   request state. */
let memoryOpen = false;

export function readOpen(): boolean {
  if (typeof window === "undefined") return false;
  if (!hasStorage()) return memoryOpen;
  return window.localStorage.getItem(KEY_OPEN) === "1";
}

/** The server never has localStorage — first paint is always the closed state. */
export function readOpenOnServer(): boolean {
  return false;
}

export function writeOpen(open: boolean): void {
  memoryOpen = open;
  if (hasStorage()) {
    if (open) window.localStorage.setItem(KEY_OPEN, "1");
    else window.localStorage.removeItem(KEY_OPEN);
  }
  for (const onChange of openListeners) onChange();
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

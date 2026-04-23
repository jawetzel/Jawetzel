"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { ChatPanel } from "./ChatPanel";
import { readOpen, writeOpen } from "./storage";

export function ChatLauncher() {
  // Render a closed launcher on SSR/first paint; hydrate open state after
  // mount so localStorage reads don't trip hydration mismatch warnings.
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOpen(readOpen());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeOpen(open);
  }, [open, hydrated]);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-primary)] text-[var(--color-text-primary)] shadow-lg transition-transform hover:scale-105 hover:bg-[var(--color-brand-primary-hover)]"
          aria-label="Open portfolio assistant"
        >
          <MessageCircle size={22} strokeWidth={2} />
        </button>
      )}

      {open && (
        <>
          {/* Backdrop: mobile only. On md+ the drawer sits alongside the
              page content, so we don't dim or block pointer events —
              clicks and scrolls outside the drawer stay live. */}
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Portfolio assistant"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
          >
            <ChatPanel onClose={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

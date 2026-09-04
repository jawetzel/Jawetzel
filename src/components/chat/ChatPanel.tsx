"use client";

import { ArrowLeft, CalendarDays, Menu, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SITE } from "@/lib/constants";
import * as api from "./api";
import { ChatView } from "./ChatView";
import { ConversationList } from "./ConversationList";
import { MessageInput } from "./MessageInput";
import { readConvoId, writeConvoId } from "./storage";
import type { ChatMessage, ConversationSummary } from "./types";

type View = "chat" | "list";

function currentPageUrl(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const { status } = useSession();
  const isAuthed = status === "authenticated";

  const [view, setView] = useState<View>("chat");

  const [convos, setConvos] = useState<ConversationSummary[]>([]);
  const [convosHasMore, setConvosHasMore] = useState(false);
  const [convosPage, setConvosPage] = useState(1);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState<string | undefined>();
  const [isThinking, setIsThinking] = useState(false);
  /* Seeded rather than set in a mount effect. Whether there is a thread to
     restore is known synchronously from localStorage, and ChatPanel only ever
     mounts client-side — the launcher renders nothing on the server until the
     drawer is open — so there is no server snapshot to mismatch. Starting in
     the correct state is what removes the false→true cascade that
     `setIsLoading(true)` inside the hydrate effect used to cause. */
  const [isLoading, setIsLoading] = useState(() => readConvoId() !== null);
  const [error, setError] = useState<string | null>(null);

  // Track which id we've already hydrated so page-remounts and session
  // transitions don't re-fetch the same thread on every render.
  const hydratedIdRef = useRef<string | null>(null);
  const claimTriedRef = useRef(false);

  /* Bumped to ask the hydrate effect below to run again, after a claim changes
     ownership of the stored thread. */
  const [hydrateNonce, setHydrateNonce] = useState(0);

  /* Restore the stored thread on mount, and again after a claim. Falls through
     silently on 404 — the stored id pointed to a claimed-or-missing thread, so
     we start fresh.

     State is written in the request's continuations, not in the effect body:
     that is the shape the effect-cascade rule asks for, and it is where the
     `cancelled` guard belongs. That guard is new and fixes a real race — a slow
     restore previously had nothing stopping it from landing after unmount, or
     from overwriting a newer thread the user had already picked from the list
     while it was still in flight. */
  useEffect(() => {
    const stored = readConvoId();
    if (!stored) {
      hydratedIdRef.current = null;
      return;
    }
    if (hydratedIdRef.current === stored) return;

    let cancelled = false;
    void api.fetchConversation(stored).then(
      (doc) => {
        if (cancelled) return;
        setActiveId(doc.id);
        setMessages(doc.messages);
        setTitle(doc.title);
        hydratedIdRef.current = doc.id;
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        writeConvoId(null);
        hydratedIdRef.current = null;
        setActiveId(null);
        setMessages([]);
        setTitle(undefined);
        setIsLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hydrateNonce]);

  /* When the user signs in, try to claim any stored anon id so the thread
     carries over. Runs exactly once per auth transition. */
  useEffect(() => {
    if (!isAuthed) return;
    if (claimTriedRef.current) return;
    const stored = readConvoId();
    if (!stored) return;
    claimTriedRef.current = true;

    let cancelled = false;
    void api
      .claimAnonConversation(stored)
      .catch(() => {
        // ignore — claimAnon is idempotent and the thread may already be
        // authed (in which case subsequent reads still work for the owner)
      })
      .then(() => {
        if (cancelled) return;
        // Re-hydrate now that ownership may have changed. Raising the loading
        // flag here keeps the spinner the claim path always showed.
        hydratedIdRef.current = null;
        setIsLoading(true);
        setHydrateNonce((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  /* Authed sidebar list. */
  const loadConversations = useCallback(
    async (page = 1) => {
      if (!isAuthed) return;
      try {
        const r = await api.listConversations(page);
        setConvos((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
        setConvosHasMore(r.hasMore);
        setConvosPage(page);
      } catch {
        // ignore
      }
    },
    [isAuthed],
  );

  /* First page of the authed sidebar list. Same shape as the hydrate effect —
     the write happens in the continuation, behind a cancel guard — rather than
     calling `loadConversations` (which the event handlers still use) straight
     out of the effect body. */
  useEffect(() => {
    if (!isAuthed) return;

    let cancelled = false;
    void api.listConversations(1).then(
      (r) => {
        if (cancelled) return;
        setConvos(r.items);
        setConvosHasMore(r.hasMore);
        setConvosPage(1);
      },
      () => {
        // ignore
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  async function selectConversation(id: string) {
    try {
      const r = await api.fetchConversation(id);
      setActiveId(r.id);
      setMessages(r.messages);
      setTitle(r.title);
      setView("chat");
      writeConvoId(r.id);
      hydratedIdRef.current = r.id;
    } catch {
      // ignore
    }
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setTitle(undefined);
    setError(null);
    setView("chat");
    writeConvoId(null);
    hydratedIdRef.current = null;
  }

  async function handleSend(message: string) {
    if (isThinking) return;
    setError(null);
    setIsThinking(true);

    const pageUrl = currentPageUrl();
    const optimistic: ChatMessage = {
      role: "user",
      content: message,
      pageUrl,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await api.sendMessage({
        message,
        pageUrl,
        conversationId: activeId,
      });
      setActiveId(res.conversationId);
      writeConvoId(res.conversationId);
      hydratedIdRef.current = res.conversationId;
      setMessages((prev) => {
        const trimmed = prev.slice(0, -1);
        return [...trimmed, res.userMessage, res.assistantMessage];
      });
      if (res.title) setTitle(res.title);
      if (isAuthed) void loadConversations(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something broke.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsThinking(false);
    }
  }

  const canOpenList = isAuthed;

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-3">
        {canOpenList && (
          <button
            onClick={() => {
              if (view === "chat") {
                void loadConversations(1);
                setView("list");
              } else {
                setView("chat");
              }
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]"
            aria-label={view === "chat" ? "Open conversations" : "Back"}
          >
            {view === "chat" ? <Menu size={16} /> : <ArrowLeft size={16} />}
          </button>
        )}
        <h2 className="flex-1 truncate text-center font-display text-sm font-semibold text-[var(--color-text-primary)]">
          {view === "list"
            ? "Conversations"
            : (title ?? "Portfolio assistant")}
        </h2>
        <a
          href={SITE.calendly}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-none items-center gap-1.5 rounded-full bg-[var(--color-brand-primary-deep)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text-inverse)] transition hover:bg-[var(--color-brand-primary-dark)]"
        >
          <CalendarDays size={12} />
          Book a call
        </a>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {view === "list" && isAuthed ? (
          <ConversationList
            items={convos}
            activeId={activeId}
            hasMore={convosHasMore}
            onSelect={selectConversation}
            onNew={() => {
              newConversation();
              setView("chat");
            }}
            onLoadMore={() => void loadConversations(convosPage + 1)}
          />
        ) : isLoading && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-text-muted)]">
            Loading your conversation…
          </div>
        ) : (
          <ChatView
            messages={messages}
            isThinking={isThinking}
            onStarterClick={handleSend}
            onNavigate={() => {
              if (
                typeof window !== "undefined" &&
                window.matchMedia("(max-width: 767px)").matches
              ) {
                onClose();
              }
            }}
          />
        )}
      </div>

      {error && (
        <div className="flex-none border-t border-[var(--color-border)] bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {view === "chat" && (
        <MessageInput onSend={handleSend} disabled={isThinking} />
      )}
    </div>
  );
}

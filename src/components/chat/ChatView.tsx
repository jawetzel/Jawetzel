"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";
import type { ChatMessage } from "./types";

export function ChatView({
  messages,
  isThinking,
  onStarterClick,
  onNavigate,
}: {
  messages: ChatMessage[];
  isThinking: boolean;
  onStarterClick: (msg: string) => void;
  onNavigate?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking]);

  if (messages.length === 0 && !isThinking) {
    return <EmptyState onStarterClick={onStarterClick} />;
  }

  return (
    <div
      ref={scrollRef}
      className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4"
    >
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} onNavigate={onNavigate} />
      ))}
      {isThinking && (
        <div className="flex items-center gap-3 pl-0.5">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--color-surface-muted)]">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-brand-primary)] [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-brand-primary)] [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-brand-primary)] [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

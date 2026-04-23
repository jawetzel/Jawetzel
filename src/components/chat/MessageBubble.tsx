"use client";

import { Sparkles, User } from "lucide-react";
import type { ChatMessage } from "./types";
import { ToolResultRenderer } from "./ToolResultRenderer";

export function MessageBubble({
  message,
  onNavigate,
}: {
  message: ChatMessage;
  onNavigate?: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
          isUser
            ? "bg-[var(--color-brand-primary)] text-[var(--color-text-primary)]"
            : "bg-[var(--color-surface-muted)] text-[var(--color-brand-primary-deep)]"
        }`}
      >
        {isUser ? <User size={15} /> : <Sparkles size={15} />}
      </div>

      <div
        className={`flex max-w-[85%] flex-col gap-1 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isUser
              ? "rounded-br-sm bg-[var(--color-brand-primary)] text-[var(--color-text-primary)]"
              : "rounded-bl-sm bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)]"
          }`}
        >
          {renderContent(message.content)}
        </div>

        {message.toolResults?.map((tr, idx) => (
          <ToolResultRenderer
            key={`${tr.tool}-${idx}`}
            payload={tr}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function renderInline(text: string, keyPrefix: string): React.ReactNode {
  const cleaned = text
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

function renderContent(text: string): React.ReactNode {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      out.push(<div key={`sp-${i}`} className="h-2" />);
      i++;
      continue;
    }
    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="my-1 list-inside list-disc space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    out.push(<p key={`p-${i}`}>{renderInline(line, `p-${i}`)}</p>);
    i++;
  }
  return out;
}

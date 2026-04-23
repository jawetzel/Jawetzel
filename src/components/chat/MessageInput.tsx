"use client";

import { ArrowUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";

export function MessageInput({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-none items-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-3"
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autoResize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
        placeholder={disabled ? "Thinking…" : "Ask about projects, posts, colors…"}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-brand-primary)] disabled:opacity-60"
        style={{ maxHeight: 160 }}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--color-brand-primary)] text-[var(--color-text-primary)] shadow-sm transition-opacity hover:bg-[var(--color-brand-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Send"
      >
        <ArrowUp size={16} strokeWidth={2.5} />
      </button>
    </form>
  );
}

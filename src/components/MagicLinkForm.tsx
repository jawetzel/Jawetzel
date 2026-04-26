"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Status = "idle" | "sending" | "sent" | "rate-limited" | "error";

export function MagicLinkForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackUrl }),
      });
      if (res.status === 429) {
        setStatus("rate-limited");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-5 py-4 text-sm">
        <p className="font-medium text-[var(--color-text-primary)]">
          Check your inbox.
        </p>
        <p className="mt-1 text-[var(--color-text-secondary)]">
          If <strong>{email}</strong> is a valid address, a sign-in link is on
          its way. The link is good for 30 minutes and only works once.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="magic-link-email" className="mb-1.5 block">
          Or sign in by email
        </Label>
        <Input
          id="magic-link-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "sending"}
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        size="md"
        disabled={status === "sending" || !email}
      >
        {status === "sending" ? "Sending…" : "Send link"}
      </Button>
      {status === "rate-limited" && (
        <p className="basis-full text-sm text-[var(--color-text-secondary)]">
          Too many attempts. Try again in a few minutes.
        </p>
      )}
      {status === "error" && (
        <p className="basis-full text-sm text-[var(--color-text-secondary)]">
          Something went wrong sending the link. Please try again.
        </p>
      )}
    </form>
  );
}

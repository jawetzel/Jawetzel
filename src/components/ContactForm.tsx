"use client";

import { useState } from "react";
import { Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";

type Status = "idle" | "sending" | "sent" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || ""),
      email: String(data.get("email") || ""),
      message: String(data.get("message") || ""),
      projectType: String(data.get("projectType") || ""),
      timeline: String(data.get("timeline") || ""),
      website: String(data.get("website") || ""),
    };

    setStatus("sending");
    setError(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Send failed." }));
        throw new Error(body.error || "Send failed.");
      }
      setStatus("sent");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Send failed.");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-brand-primary-50)] p-8 text-center">
        <CheckCircle2
          className="mx-auto mb-3 text-[var(--color-status-success)]"
          size={40}
        />
        <h3 className="font-display text-2xl font-semibold">Got it — thanks.</h3>
        <p className="mt-2 text-[var(--color-text-secondary)]">
          You&apos;ll hear back from me within a couple of business days. Check
          your inbox for a confirmation.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* honeypot */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="projectType">Project type</Label>
          <select
            id="projectType"
            name="projectType"
            className="flex h-11 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] px-4 text-sm text-[var(--color-text-primary)]"
            defaultValue=""
          >
            <option value="">Select…</option>
            <option value="Legacy modernization">Legacy modernization</option>
            <option value="Greenfield build">Greenfield build</option>
            <option value="AI ops tooling">AI ops tooling</option>
            <option value="Audit / assessment">Audit / assessment</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="timeline">Timeline (optional)</Label>
          <select
            id="timeline"
            name="timeline"
            className="flex h-11 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] px-4 text-sm text-[var(--color-text-primary)]"
            defaultValue=""
          >
            <option value="">Select…</option>
            <option value="This month">This month</option>
            <option value="Next 1–2 months">Next 1–2 months</option>
            <option value="Next quarter">Next quarter</option>
            <option value="Just exploring">Just exploring</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">What are you working on?</Label>
        <Textarea
          id="message"
          name="message"
          required
          rows={7}
          placeholder="A few sentences is plenty — what you're building, what's stuck, and what would make a conversation worth having."
        />
      </div>

      {status === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-4 text-sm">
          <AlertTriangle
            size={18}
            className="mt-0.5 text-[var(--color-status-error)]"
          />
          <div>
            <p className="font-medium text-[var(--color-status-error)]">
              {error ?? "Something went wrong."}
            </p>
            <p className="mt-1 text-[var(--color-text-secondary)]">
              You can email me directly at{" "}
              <a
                className="underline"
                href="mailto:jawetzel615@gmail.com"
              >
                jawetzel615@gmail.com
              </a>
              .
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-[var(--color-text-muted)]">
          No trackers. No list. Goes straight to my inbox.
        </p>
        <Button type="submit" variant="primary" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Send message"}
          <Send size={16} />
        </Button>
      </div>
    </form>
  );
}

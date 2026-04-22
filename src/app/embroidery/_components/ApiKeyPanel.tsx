"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { issueApiKeyAction } from "../_lib/api-key-actions";

export function ApiKeyPanel({ hasKey: initialHasKey }: { hasKey: boolean }) {
  const [hasKey, setHasKey] = useState(initialHasKey);
  const [justIssued, setJustIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function issue() {
    setError(null);
    startTransition(async () => {
      try {
        const { apiKey } = await issueApiKeyAction();
        setHasKey(true);
        setJustIssued(apiKey);
        setCopied(false);
        setConfirming(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function dismiss() {
    setJustIssued(null);
    setCopied(false);
  }

  async function copy() {
    if (!justIssued) return;
    try {
      await navigator.clipboard.writeText(justIssued);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select and copy manually.");
    }
  }

  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
          <KeyRound size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">
            Your API key
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            You&apos;ll see your key once at generation — copy it somewhere
            safe.
            <br />
            Lost it? Hit regenerate and we&apos;ll issue a new one.
          </p>
        </div>
      </div>

      <div className="mt-6">
        {justIssued && (
          <div className="rounded-2xl border-2 border-[var(--color-accent-warm)] bg-[var(--color-accent-warm-100)] p-4 md:p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={20}
                className="mt-0.5 shrink-0 text-[var(--color-accent-warm-dark)]"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Save this key now — you won&apos;t see it again.
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Lose it and you&apos;ll need to regenerate, which kills this
                  one.
                </p>
              </div>
            </div>
            <code className="mt-4 block break-all rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm text-[var(--color-text-primary)]">
              {justIssued}
            </code>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={copy} variant="primary" size="sm">
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy to clipboard"}
              </Button>
              <Button onClick={dismiss} variant="outline" size="sm">
                I&apos;ve saved it
              </Button>
            </div>
          </div>
        )}

        {!hasKey && !justIssued && (
          <Button onClick={issue} disabled={pending} variant="primary">
            {pending ? "Generating…" : "Generate API key"}
          </Button>
        )}

        {hasKey && !justIssued && (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            <ShieldCheck
              size={16}
              className="shrink-0 text-[var(--color-brand-primary-dark)]"
            />
            <span>
              An API key is active for your account.
              <br />
              Lost it? Regenerate to get a new one.
            </span>
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-[var(--color-accent-warm-dark)]">
            {error}
          </p>
        )}
      </div>

      {hasKey && !justIssued && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-6">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Lost or leaked your key?
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Regenerating issues a brand-new key and immediately invalidates the
            old one. Any integrations using the old key will stop working.
          </p>

          {!confirming ? (
            <Button
              onClick={() => setConfirming(true)}
              disabled={pending}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              <RefreshCw size={16} />
              Regenerate key
            </Button>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--color-text-primary)]">
                Confirm regenerate?
              </span>
              <Button
                onClick={issue}
                disabled={pending}
                variant="warm"
                size="sm"
              >
                {pending ? "Generating…" : "Yes, regenerate"}
              </Button>
              <Button
                onClick={() => setConfirming(false)}
                variant="ghost"
                size="sm"
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

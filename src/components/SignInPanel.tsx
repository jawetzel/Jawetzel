"use client";

import { SignInButton } from "@/components/AuthButtons";
import { MagicLinkForm } from "@/components/MagicLinkForm";

/**
 * Canonical signed-out call-to-action. Shows the Google OAuth button and the
 * magic-link form together, with a small divider between them. Use this
 * everywhere the site asks an anonymous visitor to sign in — keep
 * `SignInButton` and `MagicLinkForm` reserved for layouts that need only one.
 */
export function SignInPanel({ callbackUrl }: { callbackUrl: string }) {
  return (
    <div className="space-y-5">
      <SignInButton callbackUrl={callbackUrl} />
      <div
        className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]"
        role="separator"
        aria-orientation="horizontal"
      >
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        <span>or</span>
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>
      <MagicLinkForm callbackUrl={callbackUrl} />
    </div>
  );
}

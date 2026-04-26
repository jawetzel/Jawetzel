import { SignOutButton } from "@/components/AuthButtons";

/**
 * Signed-in identity strip — name/email on the left, sign-out on the right.
 * Used at the foot of any gated page so the visitor always knows who they're
 * signed in as and how to leave.
 */
export function AccountChip({
  email,
  name,
  callbackUrl,
}: {
  email: string;
  name: string;
  callbackUrl: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5 py-4">
      <div className="text-sm">
        <div className="font-medium text-[var(--color-text-primary)]">
          {name || email}
        </div>
        <div className="text-[var(--color-text-secondary)]">{email}</div>
      </div>
      <SignOutButton callbackUrl={callbackUrl} />
    </div>
  );
}

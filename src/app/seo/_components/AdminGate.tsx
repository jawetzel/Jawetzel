import Link from "next/link";
import { getCachedSession } from "@/lib/auth";
import { SignInPanel } from "@/components/SignInPanel";
import { SignOutButton } from "@/components/AuthButtons";

/**
 * The admin shell every `/seo` surface renders inside — header, auth gate,
 * sign-out. Extracted when `/seo` grew from one page into a workspace so the
 * three of them cannot drift into three slightly different gates.
 *
 * Server-only: it awaits the session itself and renders `children` solely on
 * the authorized path, so an unauthorized visitor never receives the tool's
 * markup at all.
 */

export async function AdminGate({
  title,
  eyebrow = "Admin",
  callbackUrl,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  eyebrow?: string;
  /** Where sign-in returns to — this page. */
  callbackUrl: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
}) {
  const session = await getCachedSession();
  const user = session?.user;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-16 md:px-6 md:pt-20">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-[var(--color-border)] pb-8 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            {backHref ? (
              <Link href={backHref} className="hover:underline">
                ← {backLabel ?? "Back"}
              </Link>
            ) : (
              eyebrow
            )}
          </p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-tight md:text-5xl">
            {title}
          </h1>
        </div>
        {user?.role === "admin" && (
          <div className="flex shrink-0 items-center gap-3 text-sm text-[var(--color-text-secondary)]">
            <span className="hidden sm:inline">{user.email}</span>
            <SignOutButton callbackUrl={callbackUrl} />
          </div>
        )}
      </div>

      <div className="mt-10">
        {!user ? (
          <div className="mx-auto max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-8">
            <h2 className="font-display text-2xl font-semibold">
              Admin sign-in
            </h2>
            <p className="mb-6 mt-2 text-sm text-[var(--color-text-secondary)]">
              This tool is for the site admin. Sign in to continue.
            </p>
            <SignInPanel callbackUrl={callbackUrl} />
          </div>
        ) : user.role !== "admin" ? (
          <div className="mx-auto max-w-md rounded-2xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-8 text-center">
            <h2 className="font-display text-2xl font-semibold">
              Not authorized
            </h2>
            <p className="mb-6 mt-2 text-sm text-[var(--color-text-secondary)]">
              You&apos;re signed in as{" "}
              <span className="font-medium">{user.email}</span>, which is not an
              admin account.
            </p>
            <SignOutButton
              callbackUrl={callbackUrl}
              label="Sign out"
              variant="outline"
            />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

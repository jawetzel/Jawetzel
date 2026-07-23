import type { Metadata } from "next";
import { getCachedSession } from "@/lib/auth";
import { createContainer } from "@/composition/container";
import { SignInPanel } from "@/components/SignInPanel";
import { SignOutButton } from "@/components/AuthButtons";
import { SeoAnalyzer } from "./_components/SeoAnalyzer";

/**
 * `/seo` — the admin driving surface for the SEO advisory engine (seo.md Part
 * 4b). It is the "admin UI" reading surface named in seo.md Part 8: a human runs
 * one page against one query by hand and reads the swaps.
 *
 * Reached from a discreet "Login" link in the footer's More column — not linked
 * from any public nav, and `noindex` so it never lands in a crawl. The page is
 * admin-only; the underlying `/api/seo/analyze` still accepts any of the three
 * principals (session, per-user key, service key) on its own terms.
 */
export const metadata: Metadata = {
  title: "SEO Analyzer",
  // The one page on an SEO tool that must not be indexed.
  robots: { index: false, follow: false },
};

export default async function SeoAdminPage() {
  const session = await getCachedSession();
  const user = session?.user;

  // Seed the client's "recent runs" list. Only admins reach the tool, so only
  // they pay for the read.
  const initialHistory =
    user?.role === "admin"
      ? await createContainer().listRecentAnalyses.execute({ limit: 20 })
      : [];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-16 md:px-6 md:pt-20">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-[var(--color-border)] pb-8 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
            Admin
          </p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-tight md:text-5xl">
            SEO Analyzer
          </h1>
          <p className="mt-2 max-w-2xl text-[var(--color-text-secondary)]">
            Measure a page against the pages currently outranking it, and get a
            flat list of swaps — what you have, what the data says to use, and a
            score for each. No LLM, no prose; measured facts only.
          </p>
        </div>
        {user?.role === "admin" && (
          <div className="flex shrink-0 items-center gap-3 text-sm text-[var(--color-text-secondary)]">
            <span className="hidden sm:inline">{user.email}</span>
            <SignOutButton callbackUrl="/seo" />
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
            <SignInPanel callbackUrl="/seo" />
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
            <SignOutButton callbackUrl="/seo" label="Sign out" variant="outline" />
          </div>
        ) : (
          <SeoAnalyzer initialHistory={initialHistory} />
        )}
      </div>
    </div>
  );
}

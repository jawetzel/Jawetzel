import type { Metadata } from "next";
import Link from "next/link";
import { getCachedSession } from "@/lib/auth";
import { createContainer } from "@/composition/container";
import { AdminGate } from "./_components/AdminGate";
import { TagList } from "./_components/TagList";

/**
 * `/seo` — the workspace's front door: the customer tags, and nothing else.
 *
 * A tag names an engagement and the property it pertains to. Picking one opens
 * `/seo/[tag]`, where the funnel runs: keywords → competitors → (later) gaps →
 * screening → page work.
 *
 * **Why the tag comes first.** `serp_competitors` and `domain_intersection` are
 * both domain-to-domain, so layers 1–2 are property-scoped and bought once;
 * layers 3–4 are page-scoped and read them for free. Without a tag to hang the
 * expensive layers on, every page would re-buy them.
 *
 * The single-page analyzer that used to live here is still reachable at
 * `/seo/analyze` — it is layer 4, and until the funnel reaches that far it
 * remains the way to work one page against one query by hand.
 *
 * Reached from a discreet "Login" link in the footer's More column — not linked
 * from any public nav, and `noindex` so it never lands in a crawl.
 */
export const metadata: Metadata = {
  title: "SEO Workspace",
  // The one page on an SEO tool that must not be indexed.
  robots: { index: false, follow: false },
};

export default async function SeoWorkspacePage() {
  const session = await getCachedSession();
  // Only admins reach the tool, so only they pay for the read.
  const tags =
    session?.user?.role === "admin"
      ? await createContainer().listSeoTags.execute()
      : [];

  return (
    <AdminGate title="SEO Workspace" callbackUrl="/seo">
      <div className="space-y-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Pick a customer tag to open its workspace.
          </p>
          <Link
            href="/seo/analyze"
            className="text-sm font-medium text-[var(--color-brand-primary-dark)] hover:underline"
          >
            Single-page analyzer →
          </Link>
        </div>
        <TagList initialTags={tags} />
      </div>
    </AdminGate>
  );
}

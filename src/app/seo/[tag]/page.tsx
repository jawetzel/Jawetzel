import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedSession } from "@/lib/auth";
import { createContainer } from "@/composition/container";
import { AdminGate } from "../_components/AdminGate";
import { Workspace } from "./_components/Workspace";

/**
 * `/seo/[tag]` — one customer's workspace, where the funnel runs.
 *
 * Layer 1 and its gate today; layers 2–4 land underneath as they are built.
 *
 * Run state lives in Mongo rather than in the browser, so this page reloads it
 * on every visit and the newest run opens by default. A funnel run costs a few
 * dollars and spans several minutes across gates — losing one to a refresh
 * would be a real cost, not an inconvenience.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SeoTagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: slug } = await params;
  const session = await getCachedSession();
  const isAdmin = session?.user?.role === "admin";

  // Only admins pay for the reads; the gate below renders the sign-in panel for
  // everyone else, and a non-admin never receives the workspace markup.
  const container = createContainer();
  const tag = isAdmin ? await container.getSeoTag.execute({ tag: slug }) : null;
  if (isAdmin && !tag) notFound();

  // The gap pile is tag-scoped and survives every run, so it loads with the
  // page rather than waiting for a run to be opened.
  const [runs, pile] =
    isAdmin && tag
      ? await Promise.all([
          container.listIntelRuns.execute({ tag: tag.tag, limit: 25 }),
          container.listGapKeywords.execute({ tag: tag.tag }),
        ])
      : [[], null];

  return (
    <AdminGate
      title={tag?.label ?? "Workspace"}
      callbackUrl={`/seo/${slug}`}
      backHref="/seo"
      backLabel="All tags"
    >
      {tag && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-text-secondary)]">
            <span className="font-mono">{tag.domain}</span>
            <span className="text-[var(--color-text-muted)]">
              {tag.locationCode} · {tag.languageCode}
            </span>
          </div>
          <Workspace
            tag={tag}
            initialRuns={runs}
            initialPile={pile ? { tag: tag.tag, ...pile } : null}
          />
        </div>
      )}
    </AdminGate>
  );
}

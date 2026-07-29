import type { Metadata } from "next";
import { getCachedSession } from "@/lib/auth";
import { createContainer } from "@/composition/container";
import { AdminGate } from "../_components/AdminGate";
import { SeoAnalyzer } from "../_components/SeoAnalyzer";

/**
 * `/seo/analyze` — the single-page analyzer, layer 4 of the funnel.
 *
 * This was `/seo` until the workspace took that route. It is unchanged: run one
 * page against one query and read the swaps, or hand Discover a bare URL and
 * let it chain the endpoints itself.
 *
 * It stays reachable on its own because it is the only layer that is finished.
 * Once the funnel reaches layer 4 this becomes the manual entry point into the
 * same engine — useful whenever you already know the page and the query and
 * don't need the funnel to find them for you.
 */
export const metadata: Metadata = {
  title: "SEO Analyzer",
  robots: { index: false, follow: false },
};

export default async function SeoAnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; q?: string }>;
}) {
  const { url, q } = await searchParams;
  const session = await getCachedSession();
  const initialHistory =
    session?.user?.role === "admin"
      ? await createContainer().listRecentAnalyses.execute({ limit: 20 })
      : [];

  return (
    <AdminGate
      title="Single-page analyzer"
      callbackUrl="/seo/analyze"
      backHref="/seo"
      backLabel="Workspace"
    >
      {/* `?url=&q=` arrive from a layer-4 verdict, so the page and query it
          decided on are not retyped by hand. */}
      <SeoAnalyzer
        initialHistory={initialHistory}
        initialUrl={url ?? ""}
        initialQuery={q ?? ""}
      />
    </AdminGate>
  );
}

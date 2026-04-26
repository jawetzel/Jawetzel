/**
 * Weekly IndexNow sweep.
 *
 * 1. Walks the same content sources the sitemap uses (static routes, projects,
 *    blog posts) and upserts each URL into the `indexnow_log` collection with
 *    its current contentUpdatedAt.
 * 2. Queries the collection for URLs that are due — never pinged, content
 *    changed since the last ping, or last ping older than 7 days.
 * 3. Submits the due set to IndexNow. Stamps lastPingedAt only on success so
 *    a transient failure retries on the next run.
 */

import { SITE } from "@/lib/constants";
import { getAllPosts } from "@/lib/blog";
import { getAllProjects } from "@/lib/projects";
import { STATIC_ROUTE_DATES } from "@/lib/sitemap-dates";
import { submitToIndexNow } from "@/lib/indexnow";
import {
  findUrlsDueForPing,
  stampPinged,
  upsertPageContent,
} from "@/lib/indexnow-tracker";

const BASE = SITE.url.replace(/\/$/, "");

// Project pages don't carry their own modification date, so all projects
// share a single date that gets bumped manually when the JSON catalog
// changes (mirrors the sitemap's behavior).
const PROJECT_BASELINE_DATE = "2026-04-13";

interface ContentEntry {
  pagePath: string;
  contentUpdatedAt: Date;
}

function buildContentList(): ContentEntry[] {
  const entries: ContentEntry[] = [];

  for (const [route, iso] of Object.entries(STATIC_ROUTE_DATES)) {
    entries.push({
      pagePath: route === "" ? "/" : route,
      contentUpdatedAt: new Date(iso),
    });
  }

  const projectBaseline = new Date(PROJECT_BASELINE_DATE);
  for (const p of getAllProjects()) {
    entries.push({
      pagePath: `/projects/${p.slug}`,
      contentUpdatedAt: projectBaseline,
    });
  }

  for (const post of getAllPosts()) {
    entries.push({
      pagePath: `/blog/${post.slug}`,
      contentUpdatedAt: new Date(post.date),
    });
  }

  return entries;
}

export async function runIndexNowPing(): Promise<{
  due: number;
  pinged: number;
}> {
  const start = Date.now();
  console.log("[indexnow-ping] Starting weekly run");

  const contentList = buildContentList();
  console.log(
    `[indexnow-ping] Tracked content: ${contentList.length} URL(s)`,
  );

  // Sync content dates into the log. New rows insert with lastPingedAt=null.
  const upsertStart = Date.now();
  await Promise.all(
    contentList.map((c) =>
      upsertPageContent(c.pagePath, c.contentUpdatedAt),
    ),
  );
  console.log(
    `[indexnow-ping] Synced ${contentList.length} content date(s) (${Date.now() - upsertStart}ms)`,
  );

  const due = await findUrlsDueForPing();
  if (due.length === 0) {
    console.log(
      `[indexnow-ping] Nothing due — exiting (total ${Date.now() - start}ms)`,
    );
    return { due: 0, pinged: 0 };
  }

  const urls = due.map((d) => `${BASE}${d.pagePath}`);
  console.log(`[indexnow-ping] ${due.length} URL(s) due for ping`);

  const result = await submitToIndexNow(urls);

  if (!result.ok) {
    console.error(
      `[indexnow-ping] Submission failed (${result.failedBatches}/${result.totalBatches} batches errored) — leaving lastPingedAt unchanged so next run retries (total ${Date.now() - start}ms)`,
    );
    return { due: due.length, pinged: 0 };
  }

  await stampPinged(due.map((d) => d.pagePath));
  console.log(
    `[indexnow-ping] Run complete — submitted ${result.totalUrls} URL(s), stamped ${due.length} (total ${Date.now() - start}ms)`,
  );
  return { due: due.length, pinged: due.length };
}

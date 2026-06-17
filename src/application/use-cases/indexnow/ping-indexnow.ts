import { type IndexNowLog } from "@/application/ports/indexnow-log";
import { type IndexNowSubmitter } from "@/application/ports/indexnow-submitter";
import { type GetAllProjects } from "@/application/use-cases/content/get-all-projects";

/**
 * PingIndexNow — the weekly IndexNow sweep, as a scheduled use-case.
 *
 * The cron scheduler (`src/worker/index.ts`) is the thin driving adapter that
 * invokes this; the Mongo ledger (`IndexNowLog`) and the HTTP ping
 * (`IndexNowSubmitter`) are driven adapters behind ports; the content read
 * (`GetAllProjects`) is an already-migrated content use-case. Config — the
 * static-route dates, the project baseline date, and the base URL — is injected
 * as pure data so the orchestration is unit-testable without the real
 * constants. The orchestration is lifted from the flat `runIndexNowPing`:
 *
 *   (a) build the content list (static routes + projects @ baseline)
 *   (b) upsert every content date into the ledger (Promise.all)
 *   (c) read the due set; nothing due → log and return { due: 0, pinged: 0 }
 *   (d) map the due paths to absolute URLs (base + pagePath)
 *   (e) submit; on failure log and return { due: n, pinged: 0 } WITHOUT stamping
 *   (f) on success stamp the due paths and return { due: n, pinged: n }
 *
 * Every console line and the elapsed-time timings are part of the behavior and
 * are preserved.
 */

interface ContentEntry {
  pagePath: string;
  contentUpdatedAt: Date;
}

export interface PingIndexNowDeps {
  log: IndexNowLog;
  submitter: IndexNowSubmitter;
  getAllProjects: GetAllProjects;
  /**
   * The `STATIC_ROUTE_DATES` map (route → ISO date). The empty-string route is
   * normalized to `"/"`, exactly as the flat job did.
   */
  staticRoutes: Record<string, string>;
  /**
   * Shared `contentUpdatedAt` for every project page — projects carry no
   * per-page date, so they share one baseline bumped manually when the catalog
   * changes (mirrors the sitemap). Parsed into a `Date` once.
   */
  projectBaselineDate: string;
  /** Site base URL with any trailing slash already stripped. */
  baseUrl: string;
}

export interface PingIndexNow {
  execute(): Promise<{ due: number; pinged: number }>;
}

export function createPingIndexNow(deps: PingIndexNowDeps): PingIndexNow {
  const {
    log,
    submitter,
    getAllProjects,
    staticRoutes,
    projectBaselineDate,
    baseUrl,
  } = deps;

  async function buildContentList(): Promise<ContentEntry[]> {
    const entries: ContentEntry[] = [];

    for (const [route, iso] of Object.entries(staticRoutes)) {
      entries.push({
        pagePath: route === "" ? "/" : route,
        contentUpdatedAt: new Date(iso),
      });
    }

    const projectBaseline = new Date(projectBaselineDate);
    const projects = await getAllProjects.execute();
    for (const p of projects) {
      entries.push({
        pagePath: `/projects/${p.slug}`,
        contentUpdatedAt: projectBaseline,
      });
    }

    return entries;
  }

  return {
    async execute() {
      const start = Date.now();
      console.log("[indexnow-ping] Starting weekly run");

      const contentList = await buildContentList();
      console.log(
        `[indexnow-ping] Tracked content: ${contentList.length} URL(s)`,
      );

      // Sync content dates into the log. New rows insert with lastPingedAt=null.
      const upsertStart = Date.now();
      await Promise.all(
        contentList.map((c) => log.upsert(c.pagePath, c.contentUpdatedAt)),
      );
      console.log(
        `[indexnow-ping] Synced ${contentList.length} content date(s) (${Date.now() - upsertStart}ms)`,
      );

      const due = await log.findDue();
      if (due.length === 0) {
        console.log(
          `[indexnow-ping] Nothing due — exiting (total ${Date.now() - start}ms)`,
        );
        return { due: 0, pinged: 0 };
      }

      const urls = due.map((d) => `${baseUrl}${d.pagePath}`);
      console.log(`[indexnow-ping] ${due.length} URL(s) due for ping`);

      const result = await submitter.submit(urls);

      if (!result.ok) {
        console.error(
          `[indexnow-ping] Submission failed (${result.failedBatches}/${result.totalBatches} batches errored) — leaving lastPingedAt unchanged so next run retries (total ${Date.now() - start}ms)`,
        );
        return { due: due.length, pinged: 0 };
      }

      await log.stampPinged(due.map((d) => d.pagePath));
      console.log(
        `[indexnow-ping] Run complete — submitted ${result.totalUrls} URL(s), stamped ${due.length} (total ${Date.now() - start}ms)`,
      );
      return { due: due.length, pinged: due.length };
    },
  };
}

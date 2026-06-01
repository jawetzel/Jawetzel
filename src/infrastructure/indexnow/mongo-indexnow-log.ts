import {
  findUrlsDueForPing,
  stampPinged,
  upsertPageContent,
} from "@/lib/indexnow-tracker";
import {
  type IndexNowLog,
  type DueUrl,
} from "@/application/ports/indexnow-log";

/**
 * MongoIndexNowLog — the production {@link IndexNowLog}, backed by the
 * `indexnow_log` Mongo collection. It delegates to the unchanged
 * `src/lib/indexnow-tracker` functions (the "wrap an existing module as an
 * adapter" migration step): the upsert, the due-logic `$or` query (never
 * pinged / content changed / stale > 7 days), and the stamp all stay in
 * `lib/indexnow-tracker` for now — this adapter only re-shapes them behind the
 * port. `findDue` narrows the full `IndexNowLogEntry` rows down to the
 * `pagePath` the use-case actually consumes.
 */
export class MongoIndexNowLog implements IndexNowLog {
  async upsert(pagePath: string, contentUpdatedAt: Date): Promise<void> {
    await upsertPageContent(pagePath, contentUpdatedAt);
  }

  async findDue(): Promise<DueUrl[]> {
    const entries = await findUrlsDueForPing();
    return entries.map((e) => ({ pagePath: e.pagePath }));
  }

  async stampPinged(pagePaths: string[]): Promise<void> {
    await stampPinged(pagePaths);
  }
}

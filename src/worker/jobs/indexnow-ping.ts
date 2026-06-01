/**
 * Weekly IndexNow sweep — thin worker entrypoint.
 *
 * The orchestration moved onto the hexagon: it now lives in the `PingIndexNow`
 * application use-case, behind the `IndexNowLog` (Mongo ledger) and
 * `IndexNowSubmitter` (HTTP ping) ports, composing the migrated content reads.
 * This file stays as a thin wrapper so the cron scheduler (`src/worker/index.ts`)
 * keeps importing `runIndexNowPing` unchanged — the scheduler is the driving
 * adapter; this resolves the use-case from the container and runs it.
 *
 * Behavior is unchanged: same content list, same due-set, same submission, same
 * stamp-only-on-success rule, same log lines, same return shape.
 */

import { createContainer } from "@/composition/container";

export async function runIndexNowPing(): Promise<{
  due: number;
  pinged: number;
}> {
  return createContainer().pingIndexNow.execute();
}

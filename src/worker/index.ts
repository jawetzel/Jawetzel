/**
 * In-process cron worker. Started from `src/instrumentation.ts` in production.
 */

import cron from "node-cron";
import { runRefreshEmbroiderySupplies } from "./jobs/refresh-embroidery-supplies";

let shuttingDown = false;

export function startWorker() {
  console.log("[worker] Starting cron jobs…");

  // Refresh embroidery supply feeds — every 12 hours
  cron.schedule("0 */12 * * *", async () => {
    if (shuttingDown) return;
    try {
      await runRefreshEmbroiderySupplies();
    } catch (err) {
      console.error("[worker] refresh-embroidery-supplies job failed:", err);
    }
  });

  console.log("[worker] Cron jobs registered");
}

function handleShutdown(signal: string) {
  console.log(`[worker] Received ${signal}, shutting down gracefully…`);
  shuttingDown = true;

  setTimeout(() => {
    console.log("[worker] Shutdown complete.");
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

/**
 * In-process cron worker. Started from `src/instrumentation.ts` in production.
 */

import cron from "node-cron";
import { runRefreshEmbroiderySupplies } from "./jobs/refresh-embroidery-supplies";

let shuttingDown = false;

export function startWorker() {
  console.log("[worker] Starting cron jobs…");

  // Refresh embroidery supply feeds — 6 AM and 8 PM US Eastern. Picked to
  // bracket US working hours: the morning run lands fresh vendor data before
  // 9 AM sales/ops activity starts, and the evening run captures any end-
  // of-day catalog/price updates vendors push after 5 PM. IANA timezone
  // (not "EST") so daylight saving is handled automatically — node-cron
  // reads the TZ for each evaluation.
  cron.schedule(
    "0 6,20 * * *",
    async () => {
      if (shuttingDown) return;
      try {
        await runRefreshEmbroiderySupplies();
      } catch (err) {
        console.error("[worker] refresh-embroidery-supplies job failed:", err);
      }
    },
    { timezone: "America/New_York" },
  );

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

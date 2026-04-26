// Monthly metric snapshots per project. No UI yet. Convention: numbers are
// captured from the last week of the month for every source.

export type SourceMetrics = {
  impressions: number;
  clicks: number;
  notes?: string;
};

export type MonthlySnapshot = {
  month: string; // "YYYY-MM"
  sources: Record<string, SourceMetrics>;
};

export const COOKJUNKIE_LAUNCH_DATE: string = "2026-03"
export const COOKJUNKIE_TRACKER: MonthlySnapshot[] = [
  {
    month: "2026-04",
    sources: {
      bing: { impressions: 4200, clicks: 56 },
      gsc: { impressions: 0, clicks: 0, notes: "started tracking" },
      fb: { impressions: 200, clicks: 5 },
    },
  },
];

export const WEEKENDPLANT_LAUNCH_DATE: string = "2026-04"
export const WEEKENDPLANT_TRACKER: MonthlySnapshot[] = [
  {
    month: "2026-04",
    sources: {
      bing: { impressions: 1, clicks: 0, notes: "started tracking" },
      gsc: { impressions: 30, clicks: 0 },
      fb: { impressions: 1500, clicks: 6, notes: "Anomaly - 1 post got massive views 1 day without clear cause" },
    },
  },
];

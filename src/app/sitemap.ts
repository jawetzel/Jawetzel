import type { MetadataRoute } from "next";
import { SITE } from "@/lib/constants";
import { createContentContainer } from "@/composition/content";
import { PROJECT_ROUTE_DATES, STATIC_ROUTE_DATES } from "@/lib/sitemap-dates";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dateWithSeededTime(dateStr: string, seed: string): Date {
  const h = hashString(seed);
  const hours = h % 24;
  const minutes = Math.floor(h / 24) % 60;
  const seconds = Math.floor(h / (24 * 60)) % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return new Date(`${dateStr}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}Z`);
}

const DAILY_CHANGE_FREQ_ROUTES = new Set(["/tools/embroidery-supplies"]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url;

  const staticEntries = Object.entries(STATIC_ROUTE_DATES).map(([r, d]) => {
    const entry: any = {
      url: `${base}${r}`,
      lastModified: new Date(d),
    };
    if (DAILY_CHANGE_FREQ_ROUTES.has(r)) {
      entry.changeFrequency = "daily";
    }
    return entry;
  });
  const content = createContentContainer();
  const projects = await content.getAllProjects.execute();
  const projectEntries = projects.map((p) => ({
    url: `${base}/projects/${p.slug}`,
    lastModified: PROJECT_ROUTE_DATES[p.slug]
      ? new Date(PROJECT_ROUTE_DATES[p.slug])
      : dateWithSeededTime("2026-04-13", p.slug),
  }));

  return [...staticEntries, ...projectEntries];
}

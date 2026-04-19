import type { MetadataRoute } from "next";
import { SITE } from "@/lib/constants";
import { getAllPosts } from "@/lib/blog";
import { getAllProjects } from "@/lib/projects";
import { STATIC_ROUTE_DATES } from "@/lib/sitemap-dates";

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

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.url;

  const staticEntries = Object.entries(STATIC_ROUTE_DATES).map(([r, d]) => ({
    url: `${base}${r}`,
    lastModified: new Date(d),
  }));
  const projectEntries = getAllProjects().map((p) => ({
    url: `${base}/projects/${p.slug}`,
    lastModified: dateWithSeededTime("2026-04-13", p.slug),
  }));
  const postEntries = getAllPosts().map((p) => ({
    url: `${base}/blog/${p.slug}`,
    lastModified: dateWithSeededTime(p.date, p.slug),
  }));

  return [...staticEntries, ...projectEntries, ...postEntries];
}

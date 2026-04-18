import type { MetadataRoute } from "next";
import { SITE } from "@/lib/constants";
import { getAllPosts } from "@/lib/blog";
import { getAllProjects } from "@/lib/projects";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.url;
  const staticRoutes = ["", "/about", "/projects", "/blog", "/resume", "/contact", "/privacy"];
  const now = new Date();

  const staticEntries = staticRoutes.map((r) => ({
    url: `${base}${r}`,
    lastModified: now,
  }));
  const projectEntries = getAllProjects().map((p) => ({
    url: `${base}/projects/${p.slug}`,
    lastModified: now,
  }));
  const postEntries = getAllPosts().map((p) => ({
    url: `${base}/blog/${p.slug}`,
    lastModified: new Date(p.date),
  }));

  return [...staticEntries, ...projectEntries, ...postEntries];
}

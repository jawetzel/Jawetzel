import { NextResponse } from "next/server";
import { SITE } from "@/lib/constants";
import { getAllPosts } from "@/lib/blog";

export async function GET() {
  const posts = getAllPosts();
  const items = posts
    .map((p) => {
      const link = `${SITE.url}/blog/${p.slug}`;
      const pubDate = new Date(p.date).toUTCString();
      const enclosure = p.youtubeId
        ? `<enclosure url="https://www.youtube.com/watch?v=${p.youtubeId}" type="video/mp4" />`
        : "";
      return `<item>
  <title><![CDATA[${p.title}]]></title>
  <link>${link}</link>
  <guid isPermaLink="true">${link}</guid>
  <pubDate>${pubDate}</pubDate>
  <description><![CDATA[${p.description}]]></description>
  ${p.tags.map((t) => `<category>${t}</category>`).join("\n  ")}
  ${enclosure}
</item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE.name} — blog</title>
    <link>${SITE.url}</link>
    <description>${SITE.description}</description>
    <language>en-us</language>
    ${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

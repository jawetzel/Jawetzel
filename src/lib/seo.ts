import type { Metadata } from "next";
import { SITE } from "./constants";

type PageMetadataArgs = {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
  publishedTime?: string;
  tags?: readonly string[];
};

// Per-page openGraph/twitter blocks fully replace the layout defaults
// (Next merges metadata shallowly), so this helper exists to keep title,
// description, canonical, openGraph, and twitter in lockstep on every page.
export function pageMetadata({
  title,
  description,
  path,
  ogType = "website",
  publishedTime,
  tags,
}: PageMetadataArgs): Metadata {
  const fullTitle = `${title} · ${SITE.name}`;
  const image = "/opengraph-image";

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: ogType,
      siteName: SITE.name,
      title: fullTitle,
      description,
      url: path,
      images: [image],
      ...(publishedTime ? { publishedTime } : {}),
      ...(tags ? { tags: [...tags] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [image],
    },
  };
}

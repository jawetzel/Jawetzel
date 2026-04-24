import { SITE } from "./constants";
import type { BlogPost } from "./blog";
import type { ProjectCaseStudy } from "./projects";

const SITE_URL = SITE.url;
const PERSON_ID = `${SITE_URL}/#person`;
const WEBSITE_ID = `${SITE_URL}/#website`;

type SchemaObject = Record<string, unknown>;

export type Crumb = { name: string; path: string };

export function personSchema(): SchemaObject {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: SITE.name,
    url: SITE_URL,
    image: `${SITE_URL}/avatar.png`,
    jobTitle: "Full-stack developer",
    description: SITE.description,
    email: `mailto:${SITE.email}`,
    telephone: `+1-${SITE.phone}`,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Prairieville",
      addressRegion: "LA",
      addressCountry: "US",
    },
    knowsAbout: [
      "Legacy system modernization",
      ".NET Core",
      "Node.js",
      "React",
      "Next.js",
      "AI-assisted ops tooling",
      "Solo SaaS engineering",
    ],
    sameAs: [SITE.github, SITE.linkedin],
  };
}

export function websiteSchema(): SchemaObject {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE.name,
    description: SITE.description,
    publisher: { "@id": PERSON_ID },
    inLanguage: "en-US",
  };
}

// Always prepends Home; pages pass only the trail beyond Home.
export function breadcrumbSchema(trail: Crumb[]): SchemaObject {
  const all: Crumb[] = [{ name: "Home", path: "/" }, ...trail];
  return {
    "@type": "BreadcrumbList",
    itemListElement: all.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  };
}

export function blogPostingSchema(post: BlogPost): SchemaObject {
  const url = `${SITE_URL}/blog/${post.slug}`;
  const image = post.hero
    ? `${SITE_URL}${post.hero}`
    : post.youtubeId
      ? `https://i.ytimg.com/vi/${post.youtubeId}/maxresdefault.jpg`
      : `${SITE_URL}/opengraph-image`;
  return {
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: post.title,
    description: post.description,
    url,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: "en-US",
    keywords: post.tags.join(", "),
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    image,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isPartOf: { "@id": WEBSITE_ID },
  };
}

export function softwareApplicationSchema(
  project: ProjectCaseStudy
): SchemaObject {
  const out: SchemaObject = {
    "@type": "SoftwareApplication",
    name: project.name,
    description: project.tagline,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    creator: { "@id": PERSON_ID },
  };
  if (project.url) out.url = project.url;
  if (project.logo) out.image = `${SITE_URL}${project.logo}`;
  return out;
}

export function projectCaseStudySchema(
  project: ProjectCaseStudy
): SchemaObject {
  const path = `/projects/${project.slug}`;
  const pageUrl = `${SITE_URL}${path}`;
  return {
    "@type": "WebPage",
    "@id": pageUrl,
    url: pageUrl,
    name: `${project.name} — Case study`,
    description: project.tagline,
    isPartOf: { "@id": WEBSITE_ID },
    author: { "@id": PERSON_ID },
    mainEntity: softwareApplicationSchema(project),
  };
}

type CollectionItem = { name: string; path: string; description?: string };

export function collectionPageSchema(args: {
  name: string;
  description: string;
  path: string;
  items: CollectionItem[];
}): SchemaObject {
  const url = `${SITE_URL}${args.path}`;
  return {
    "@type": "CollectionPage",
    "@id": url,
    url,
    name: args.name,
    description: args.description,
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: args.items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}${it.path}`,
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
      })),
    },
  };
}

export function aboutPageSchema(): SchemaObject {
  const url = `${SITE_URL}/about`;
  return {
    "@type": "AboutPage",
    "@id": url,
    url,
    name: `About · ${SITE.name}`,
    description:
      "About Joshua Wetzel — full-stack developer based in Greater Baton Rouge.",
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: { "@id": PERSON_ID },
  };
}

export function contactPageSchema(): SchemaObject {
  const url = `${SITE_URL}/contact`;
  return {
    "@type": "ContactPage",
    "@id": url,
    url,
    name: `Contact · ${SITE.name}`,
    description:
      "Direct contact information for Joshua Wetzel — email, phone, LinkedIn, GitHub.",
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: { "@id": PERSON_ID },
  };
}

export function profilePageSchema(): SchemaObject {
  const url = `${SITE_URL}/resume`;
  return {
    "@type": "ProfilePage",
    "@id": url,
    url,
    name: `Resume · ${SITE.name}`,
    description:
      "Full-stack developer resume — .NET Core, Node, React, Next.js.",
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: { "@id": PERSON_ID },
  };
}

export function articleSchema(args: {
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  image?: string;
}): SchemaObject {
  const url = `${SITE_URL}${args.path}`;
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: args.headline,
    description: args.description,
    url,
    datePublished: args.datePublished,
    dateModified: args.dateModified ?? args.datePublished,
    inLanguage: "en-US",
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    image: args.image ?? `${SITE_URL}/opengraph-image`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isPartOf: { "@id": WEBSITE_ID },
  };
}

export function techArticleSchema(args: {
  path: string;
  headline: string;
  description: string;
  proficiencyLevel?: "Beginner" | "Expert";
}): SchemaObject {
  const url = `${SITE_URL}${args.path}`;
  return {
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline: args.headline,
    description: args.description,
    url,
    inLanguage: "en-US",
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isPartOf: { "@id": WEBSITE_ID },
    proficiencyLevel: args.proficiencyLevel ?? "Expert",
  };
}

export function webApplicationSchema(args: {
  path: string;
  name: string;
  description: string;
  applicationCategory?: string;
}): SchemaObject {
  const url = `${SITE_URL}${args.path}`;
  return {
    "@type": "WebApplication",
    "@id": `${url}#app`,
    name: args.name,
    description: args.description,
    url,
    applicationCategory: args.applicationCategory ?? "UtilitiesApplication",
    operatingSystem: "Web",
    creator: { "@id": PERSON_ID },
    isPartOf: { "@id": WEBSITE_ID },
  };
}

export function JsonLd({
  graph,
}: {
  graph: SchemaObject | SchemaObject[];
}) {
  const list = Array.isArray(graph) ? graph : [graph];
  const payload = { "@context": "https://schema.org", "@graph": list };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(payload).replace(/</g, "\\u003c"),
      }}
    />
  );
}

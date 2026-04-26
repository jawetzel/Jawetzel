import { headers } from "next/headers";
import { SITE } from "./constants";
import type { BlogPost } from "./blog";
import type { ProjectCaseStudy } from "./projects";

const SITE_URL = SITE.url;
const PERSON_ID = `${SITE_URL}/#person`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const BUSINESS_ID = `${SITE_URL}/#business`;

type SchemaObject = Record<string, unknown>;

export type Crumb = { name: string; path: string };

const PRAIRIEVILLE_GEO = {
  "@type": "GeoCoordinates",
  latitude: 30.2885,
  longitude: -90.9853,
} as const;

const SERVICE_AREA = {
  "@type": "GeoCircle",
  geoMidpoint: PRAIRIEVILLE_GEO,
  geoRadius: 40234, // ~25 miles in meters — immediate Baton Rouge metro core
} as const;

const SERVED_PLACES = [
  { "@type": "City", name: "Prairieville, LA" },
  { "@type": "City", name: "St. George, LA" },
  { "@type": "City", name: "Baton Rouge, LA" },
  { "@type": "City", name: "Denham Springs, LA" },
  { "@type": "City", name: "Gonzales, LA" },
  { "@type": "AdministrativeArea", name: "Louisiana" },
  { "@type": "Country", name: "United States" },
] as const;

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
      postalCode: "70769",
      addressCountry: "US",
    },
    homeLocation: {
      "@type": "Place",
      name: "Prairieville, Louisiana",
      geo: PRAIRIEVILLE_GEO,
    },
    workLocation: {
      "@type": "Place",
      name: "Greater Baton Rouge, Louisiana",
      geo: PRAIRIEVILLE_GEO,
    },
    areaServed: SERVED_PLACES,
    knowsAbout: [
      "Legacy system modernization",
      ".NET Core",
      "Node.js",
      "React",
      "Next.js",
      "AI-assisted ops tooling",
      "Solo SaaS engineering",
      "Stripe Connect",
      "WordPress migration",
      "Security audits",
    ],
    sameAs: [SITE.github, SITE.linkedin],
  };
}

export function professionalServiceSchema(): SchemaObject {
  return {
    "@type": "ProfessionalService",
    "@id": BUSINESS_ID,
    name: `${SITE.name} — Software Development`,
    url: SITE_URL,
    image: `${SITE_URL}/avatar.png`,
    description:
      "Independent full-stack software developer based in Prairieville, Louisiana — working on-site across Greater Baton Rouge and remote nationwide.",
    founder: { "@id": PERSON_ID },
    provider: { "@id": PERSON_ID },
    email: `mailto:${SITE.email}`,
    telephone: `+1-${SITE.phone}`,
    priceRange: "$$$",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Prairieville",
      addressRegion: "LA",
      postalCode: "70769",
      addressCountry: "US",
    },
    geo: PRAIRIEVILLE_GEO,
    areaServed: [SERVICE_AREA, ...SERVED_PLACES],
    serviceType: [
      "Custom software development",
      "Legacy system modernization",
      "Web application development",
      "AI-assisted workflow tooling",
      "Stripe and payments integration",
      "Booking and scheduling systems",
      "Security audits and hardening",
      "WordPress modernization",
      "Accessibility (WCAG) remediation",
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Engagements",
      itemListElement: [
        {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          itemOffered: {
            "@type": "Service",
            name: "Free initial consultation",
            description:
              "30–60 minute scoping conversation, in person locally or remote — no invoice and no high-pressure pitch.",
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: "Legacy modernization",
            description:
              "Incrementally migrate an aging VB, classic ASP, or in-house .NET system onto a modern stack without taking it offline.",
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: "AI-native ops tooling",
            description:
              "Internal tools that wrap AI agents in dry-run, review, and audit workflows your team already uses.",
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: "Solo-shipped product builds",
            description:
              "End-to-end delivery of a focused product — auth, payments, integrations, and the operational plumbing.",
          },
        },
        {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: "Security audit and hardening",
            description:
              "Zero-knowledge audit, written report, and concrete fixes for the bug patterns that quietly put company data at risk.",
          },
        },
      ],
    },
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

export async function JsonLd({
  graph,
}: {
  graph: SchemaObject | SchemaObject[];
}) {
  const list = Array.isArray(graph) ? graph : [graph];
  const payload = { "@context": "https://schema.org", "@graph": list };
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Browsers clear the nonce attribute after applying CSP, so React's
      // hydration check sees `nonce=""` in the DOM vs. the real nonce in vdom.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(payload).replace(/</g, "\\u003c"),
      }}
    />
  );
}

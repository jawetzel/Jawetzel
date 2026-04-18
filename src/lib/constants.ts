export const RATE_LIMITS = {
  contact: {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  },
} as const;

export const SITE = {
  name: "Joshua Wetzel",
  domain: "jawetzel.com",
  url: "https://jawetzel.com",
  email: "jawetzel615@gmail.com",
  phone: "225-305-9321",
  location: "Greater Baton Rouge, LA",
  github: "https://github.com/jawetzel",
  linkedin: "https://www.linkedin.com/in/joshua-wetzel-97a714130",
  tagline: "Full-stack dev. Modernizing legacy systems.",
  description:
    "Full-stack developer with 6+ years across .NET Core, Node, React, Next.js. I modernize legacy systems, build AI-assisted ops tooling, and ship solo products end-to-end.",
} as const;

import { FsJsonContentSource } from "@/infrastructure/content/fs-json-content-source";
import {
  createGetResume,
  type GetResume,
} from "@/application/use-cases/content/get-resume";
import {
  createGetAllProjects,
  type GetAllProjects,
} from "@/application/use-cases/content/get-all-projects";
import {
  createGetFeaturedProjects,
  type GetFeaturedProjects,
} from "@/application/use-cases/content/get-featured-projects";
import {
  createGetProjectBySlug,
  type GetProjectBySlug,
} from "@/application/use-cases/content/get-project-by-slug";
import {
  createGetAllPosts,
  type GetAllPosts,
} from "@/application/use-cases/content/get-all-posts";
import {
  createGetPostBySlug,
  type GetPostBySlug,
} from "@/application/use-cases/content/get-post-by-slug";
import {
  createGetAllTags,
  type GetAllTags,
} from "@/application/use-cases/content/get-all-tags";
import {
  createGetPostsByKind,
  type GetPostsByKind,
} from "@/application/use-cases/content/get-posts-by-kind";
import {
  createGetTestimonials,
  type GetTestimonials,
} from "@/application/use-cases/content/get-testimonials";
import {
  createGetMarqueeItems,
  type GetMarqueeItems,
} from "@/application/use-cases/content/get-marquee-items";
import {
  createSearchProjects,
  type SearchProjects,
} from "@/application/use-cases/ai/search-projects";
import {
  createSearchBlog,
  type SearchBlog,
} from "@/application/use-cases/ai/search-blog";
import {
  createGetResumeSection,
  type GetResumeSection,
} from "@/application/use-cases/ai/get-resume-section";

/**
 * Content composition root — wiring for the file-sourced *read* use-cases,
 * kept separate from the main `container.ts` on purpose: it imports only the
 * filesystem `ContentSource`, never the Mongo/Brevo adapters. That matters
 * because `src/lib/mongodb.ts` connects (and throws on a missing
 * `DATABASE_URL`) at import time, so a statically-rendered page that resolved
 * its content from the full container would drag the database into the build.
 * Driving adapters for content reads call `createContentContainer()` instead.
 *
 * (Composition may be more than one module — the rule is that adapters are
 * imported *only* here, not that there's a single function. Once `mongodb.ts`
 * is made lazy, these could merge.)
 */
const contentSource = new FsJsonContentSource();

export interface ContentContainer {
  getResume: GetResume;
  getAllProjects: GetAllProjects;
  getFeaturedProjects: GetFeaturedProjects;
  getProjectBySlug: GetProjectBySlug;
  getAllPosts: GetAllPosts;
  getPostBySlug: GetPostBySlug;
  getAllTags: GetAllTags;
  getPostsByKind: GetPostsByKind;
  getTestimonials: GetTestimonials;
  getMarqueeItems: GetMarqueeItems;
  searchProjects: SearchProjects;
  searchBlog: SearchBlog;
  getResumeSection: GetResumeSection;
}

export function createContentContainer(): ContentContainer {
  const getResume = createGetResume({ content: contentSource });
  const getAllProjects = createGetAllProjects({ content: contentSource });
  const getAllPosts = createGetAllPosts({ content: contentSource });

  return {
    getResume,
    getAllProjects,
    getFeaturedProjects: createGetFeaturedProjects({ content: contentSource }),
    getProjectBySlug: createGetProjectBySlug({ content: contentSource }),
    getAllPosts,
    getPostBySlug: createGetPostBySlug({ content: contentSource }),
    getAllTags: createGetAllTags({ content: contentSource }),
    getPostsByKind: createGetPostsByKind({ content: contentSource }),
    getTestimonials: createGetTestimonials({ content: contentSource }),
    getMarqueeItems: createGetMarqueeItems({ content: contentSource }),
    // AI content tools compose the existing content reads above (use-case
    // composing use-case keeps the sort/cap/parse rules in one place); they
    // need only content, so they wire through this DB-free container.
    searchProjects: createSearchProjects({ getAllProjects }),
    searchBlog: createSearchBlog({ getAllPosts }),
    getResumeSection: createGetResumeSection({ getResume }),
  };
}

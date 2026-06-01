import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  type IndexNowLog,
  type DueUrl,
} from "@/application/ports/indexnow-log";
import {
  type IndexNowSubmitter,
  type IndexNowSubmissionResult,
} from "@/application/ports/indexnow-submitter";
import { type GetAllProjects } from "@/application/use-cases/content/get-all-projects";
import { type GetAllPosts } from "@/application/use-cases/content/get-all-posts";
import { type ProjectCaseStudy } from "@/domain/content/project";
import { type BlogPost } from "@/domain/content/blog-post";
import { createPingIndexNow } from "./ping-indexnow";

/**
 * In-memory fake ledger. Records every upsert and every stampPinged call so the
 * test can assert the synced content list, the stamp-only-on-success rule, and
 * that nothing-due short-circuits before submission. `findDue` returns a
 * pre-seeded due set — the Mongo due-logic itself stays in `lib/indexnow-tracker`
 * (wrapped, not migrated), so this slice does not re-test it.
 */
class FakeIndexNowLog implements IndexNowLog {
  readonly upserts: { pagePath: string; contentUpdatedAt: Date }[] = [];
  readonly stamped: string[][] = [];
  constructor(private readonly due: DueUrl[]) {}

  async upsert(pagePath: string, contentUpdatedAt: Date): Promise<void> {
    this.upserts.push({ pagePath, contentUpdatedAt });
  }
  async findDue(): Promise<DueUrl[]> {
    return this.due;
  }
  async stampPinged(pagePaths: string[]): Promise<void> {
    this.stamped.push(pagePaths);
  }
}

class FakeIndexNowSubmitter implements IndexNowSubmitter {
  readonly calls: string[][] = [];
  constructor(private readonly result: IndexNowSubmissionResult) {}
  async submit(urls: string[]): Promise<IndexNowSubmissionResult> {
    this.calls.push(urls);
    return this.result;
  }
}

function fakeGetAllProjects(slugs: string[]): GetAllProjects {
  return {
    async execute() {
      return slugs.map(
        (slug) =>
          ({
            slug,
            name: slug,
            tagline: "",
            stack: [],
            problem: "",
            actions: [],
            outcome: "",
            underTheHood: "",
          }) as ProjectCaseStudy,
      );
    },
  };
}

function fakeGetAllPosts(posts: { slug: string; date: string }[]): GetAllPosts {
  return {
    async execute() {
      return posts.map(
        (p) =>
          ({
            slug: p.slug,
            date: p.date,
            title: "",
            description: "",
            tags: [],
            kind: "article",
            bodyMd: "",
          }) as BlogPost,
      );
    },
  };
}

const STATIC_ROUTES = {
  "": "2026-04-28T18:00:00Z",
  "/about": "2026-04-28T18:00:00Z",
};
const PROJECT_BASELINE = "2026-04-13";
const BASE_URL = "https://jawetzel.com";

function okResult(over: Partial<IndexNowSubmissionResult> = {}): IndexNowSubmissionResult {
  return {
    ok: true,
    totalUrls: 0,
    totalBatches: 1,
    succeededBatches: 1,
    failedBatches: 0,
    durationMs: 1,
    ...over,
  };
}

function failResult(over: Partial<IndexNowSubmissionResult> = {}): IndexNowSubmissionResult {
  return {
    ok: false,
    totalUrls: 0,
    totalBatches: 2,
    succeededBatches: 1,
    failedBatches: 1,
    durationMs: 1,
    ...over,
  };
}

describe("PingIndexNow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the content list from static routes + projects (baseline) + posts (post.date) and upserts each", async () => {
    const log = new FakeIndexNowLog([]);
    const submitter = new FakeIndexNowSubmitter(okResult());

    await createPingIndexNow({
      log,
      submitter,
      getAllProjects: fakeGetAllProjects(["alpha", "beta"]),
      getAllPosts: fakeGetAllPosts([{ slug: "hello", date: "2026-01-02" }]),
      staticRoutes: STATIC_ROUTES,
      projectBaselineDate: PROJECT_BASELINE,
      baseUrl: BASE_URL,
    }).execute();

    // Empty-string static route maps to "/"; projects/blog get their prefixes.
    expect(log.upserts.map((u) => u.pagePath)).toEqual([
      "/",
      "/about",
      "/projects/alpha",
      "/projects/beta",
      "/blog/hello",
    ]);

    // Static routes use their ISO date; projects share the baseline; posts use
    // post.date.
    const byPath = Object.fromEntries(
      log.upserts.map((u) => [u.pagePath, u.contentUpdatedAt]),
    );
    expect(byPath["/"]).toEqual(new Date("2026-04-28T18:00:00Z"));
    expect(byPath["/projects/alpha"]).toEqual(new Date(PROJECT_BASELINE));
    expect(byPath["/projects/beta"]).toEqual(new Date(PROJECT_BASELINE));
    expect(byPath["/blog/hello"]).toEqual(new Date("2026-01-02"));
  });

  it("nothing due → returns { due: 0, pinged: 0 } and never calls the submitter", async () => {
    const log = new FakeIndexNowLog([]);
    const submitter = new FakeIndexNowSubmitter(okResult());

    const result = await createPingIndexNow({
      log,
      submitter,
      getAllProjects: fakeGetAllProjects([]),
      getAllPosts: fakeGetAllPosts([]),
      staticRoutes: STATIC_ROUTES,
      projectBaselineDate: PROJECT_BASELINE,
      baseUrl: BASE_URL,
    }).execute();

    expect(result).toEqual({ due: 0, pinged: 0 });
    expect(submitter.calls).toEqual([]);
    expect(log.stamped).toEqual([]);
  });

  it("due + submit ok → maps each url to base + pagePath, stamps the due paths, returns { due: n, pinged: n }", async () => {
    const due: DueUrl[] = [
      { pagePath: "/" },
      { pagePath: "/projects/alpha" },
      { pagePath: "/blog/hello" },
    ];
    const log = new FakeIndexNowLog(due);
    const submitter = new FakeIndexNowSubmitter(okResult({ totalUrls: 3 }));

    const result = await createPingIndexNow({
      log,
      submitter,
      getAllProjects: fakeGetAllProjects(["alpha"]),
      getAllPosts: fakeGetAllPosts([{ slug: "hello", date: "2026-01-02" }]),
      staticRoutes: STATIC_ROUTES,
      projectBaselineDate: PROJECT_BASELINE,
      baseUrl: BASE_URL,
    }).execute();

    expect(submitter.calls).toEqual([
      [
        "https://jawetzel.com/",
        "https://jawetzel.com/projects/alpha",
        "https://jawetzel.com/blog/hello",
      ],
    ]);
    expect(log.stamped).toEqual([
      ["/", "/projects/alpha", "/blog/hello"],
    ]);
    expect(result).toEqual({ due: 3, pinged: 3 });
  });

  it("due + submit NOT ok → does NOT stamp and returns { due: n, pinged: 0 } (retries next run)", async () => {
    const due: DueUrl[] = [{ pagePath: "/" }, { pagePath: "/about" }];
    const log = new FakeIndexNowLog(due);
    const submitter = new FakeIndexNowSubmitter(failResult());

    const result = await createPingIndexNow({
      log,
      submitter,
      getAllProjects: fakeGetAllProjects([]),
      getAllPosts: fakeGetAllPosts([]),
      staticRoutes: STATIC_ROUTES,
      projectBaselineDate: PROJECT_BASELINE,
      baseUrl: BASE_URL,
    }).execute();

    // The riskiest rule: a failed submission must leave lastPingedAt untouched.
    expect(log.stamped).toEqual([]);
    expect(submitter.calls.length).toBe(1);
    expect(result).toEqual({ due: 2, pinged: 0 });
  });
});

import { BrevoEmailSender } from "@/infrastructure/messaging/brevo-email-sender";
import { InProcessMagicLinkTokens } from "@/infrastructure/auth/in-process-magic-link-tokens";
import { MongoUserRepository } from "@/infrastructure/mongo/mongo-user-repository";
import { NextAuthSessionGateway } from "@/infrastructure/auth/nextauth-session-gateway";
import { ApiKeyVerifierAdapter } from "@/infrastructure/auth/api-key-verifier-adapter";
import { ServiceKeyVerifierAdapter } from "@/infrastructure/auth/service-key-verifier-adapter";
import { MemTtlCache } from "@/infrastructure/cache/mem-ttl-cache";
import { MongoIndexNowLog } from "@/infrastructure/indexnow/mongo-indexnow-log";
import { HttpIndexNowSubmitter } from "@/infrastructure/indexnow/http-indexnow-submitter";
import { FsJsonContentSource } from "@/infrastructure/content/fs-json-content-source";
import { MongoConversationStore } from "@/infrastructure/mongo/mongo-conversation-store";
import { PlaywrightPageCrawlGateway } from "@/infrastructure/seo/playwright-page-crawl-gateway";
import { DataForSeoSerpGateway } from "@/infrastructure/seo/dataforseo-serp-gateway";
import { DataForSeoKeywordMetricsGateway } from "@/infrastructure/seo/dataforseo-keyword-metrics-gateway";
import { DataForSeoRankedKeywordsGateway } from "@/infrastructure/seo/dataforseo-ranked-keywords-gateway";
import { DataForSeoSerpCompetitorsGateway } from "@/infrastructure/seo/dataforseo-serp-competitors-gateway";
import { DataForSeoDomainIntersectionGateway } from "@/infrastructure/seo/dataforseo-domain-intersection-gateway";
import { MongoSeoCorpusRepository } from "@/infrastructure/seo/mongo-seo-corpus-repository";
import { MongoSeoAnalysisRepository } from "@/infrastructure/seo/mongo-seo-analysis-repository";
import { MongoSeoWorkspaceRepository } from "@/infrastructure/seo/mongo-seo-workspace-repository";
import { MongoSeoGapRepository } from "@/infrastructure/seo/mongo-seo-gap-repository";
import { MongoSeoRoutingRepository } from "@/infrastructure/seo/mongo-seo-routing-repository";
import { getLlmGateway } from "@/composition/llm";
import { resolvePageContext } from "@/composition/chat-page-context";
import { dispatchTool, toolSchemas } from "@/lib/ai/tools/registry";
import { type ToolSchema } from "@/application/ports/llm-gateway";
import {
  createSubmitContactInquiry,
  type SubmitContactInquiry,
} from "@/application/use-cases/contact/submit-contact-inquiry";
import {
  createRequestMagicLink,
  type RequestMagicLink,
} from "@/application/use-cases/auth/request-magic-link";
import {
  createConsumeMagicLink,
  type ConsumeMagicLink,
} from "@/application/use-cases/auth/consume-magic-link";
import {
  createFindOrCreateGoogleUser,
  type FindOrCreateGoogleUser,
} from "@/application/use-cases/auth/find-or-create-google-user";
import {
  createNotifyEmbroideryReady,
  type NotifyEmbroideryReady,
} from "@/application/use-cases/embroidery/notify-embroidery-ready";
import {
  createAuthenticateRequest,
  type AuthenticateRequest,
} from "@/application/use-cases/auth/authenticate-request";
import {
  createIssueApiKey,
  type IssueApiKey,
} from "@/application/use-cases/auth/issue-api-key";
import {
  createPingIndexNow,
  type PingIndexNow,
} from "@/application/use-cases/indexnow/ping-indexnow";
import {
  createRunAssistantTurn,
  type RunAssistantTurn,
} from "@/application/use-cases/chat/run-assistant-turn";
import {
  createSummarizeConversationTitle,
  type SummarizeConversationTitle,
} from "@/application/use-cases/chat/summarize-conversation-title";
import {
  createAnalyzePage,
  type AnalyzePage,
} from "@/application/use-cases/seo/analyze-page";
import {
  createListRecentAnalyses,
  type ListRecentAnalyses,
} from "@/application/use-cases/seo/list-recent-analyses";
import {
  createSuggestQueries,
  type SuggestQueries,
} from "@/application/use-cases/seo/suggest-queries";
import {
  createDiscoverCompetitorQueries,
  type DiscoverCompetitorQueries,
} from "@/application/use-cases/seo/discover-competitor-queries";
import {
  createCreateSeoTag,
  type CreateSeoTag,
} from "@/application/use-cases/seo/create-seo-tag";
import {
  createListSeoTags,
  type ListSeoTags,
} from "@/application/use-cases/seo/list-seo-tags";
import {
  createGetSeoTag,
  type GetSeoTag,
} from "@/application/use-cases/seo/get-seo-tag";
import {
  createStartIntelRun,
  type StartIntelRun,
} from "@/application/use-cases/seo/start-intel-run";
import {
  createApproveCompetitors,
  type ApproveCompetitors,
} from "@/application/use-cases/seo/approve-competitors";
import {
  createGetIntelRun,
  type GetIntelRun,
} from "@/application/use-cases/seo/get-intel-run";
import {
  createListIntelRuns,
  type ListIntelRuns,
} from "@/application/use-cases/seo/list-intel-runs";
import {
  createBuildGapPile,
  type BuildGapPile,
} from "@/application/use-cases/seo/build-gap-pile";
import {
  createListGapKeywords,
  type ListGapKeywords,
} from "@/application/use-cases/seo/list-gap-keywords";
import {
  createSetGapStatus,
  type SetGapStatus,
} from "@/application/use-cases/seo/set-gap-status";
import {
  createScreenFinalists,
  type ScreenFinalists,
} from "@/application/use-cases/seo/screen-finalists";
import {
  createRoutePageKeywords,
  type RoutePageKeywords,
} from "@/application/use-cases/seo/route-page-keywords";
import {
  createOverrideRouting,
  type OverrideRouting,
} from "@/application/use-cases/seo/override-routing";
import {
  createListBacklog,
  type ListBacklog,
} from "@/application/use-cases/seo/list-backlog";
import {
  createRenderWorkOrder,
  type RenderWorkOrder,
} from "@/application/use-cases/seo/render-work-order";
import { createGetAllProjects } from "@/application/use-cases/content/get-all-projects";
import { STATIC_ROUTE_DATES } from "@/lib/sitemap-dates";
import { SITE } from "@/lib/constants";

/**
 * Composition root — the *only* layer that imports concrete adapters and reads
 * environment/config. Driving adapters (route handlers, server actions, the
 * cron scheduler) call `createContainer()` to resolve use-cases; they never
 * `new` an adapter themselves. See `docs/architecture/overview.md` → DI.
 *
 * Adapters here are stateless singletons. As more slices migrate, this grows a
 * member per use-case; request-scoped context (e.g. the auth principal) will be
 * threaded in via the optional `ctx` argument.
 */
const cache = new MemTtlCache();
const emailSender = new BrevoEmailSender();
const magicLinkTokens = new InProcessMagicLinkTokens({ cache });
const userRepository = new MongoUserRepository();
const sessionGateway = new NextAuthSessionGateway();
const apiKeyVerifier = new ApiKeyVerifierAdapter({ cache });
const serviceKeyVerifier = new ServiceKeyVerifierAdapter();
const indexNowLog = new MongoIndexNowLog();
const indexNowSubmitter = new HttpIndexNowSubmitter();
const llmGateway = getLlmGateway();
const conversationStore = new MongoConversationStore();
// The worker process always has Mongo and every caller is the cron scheduler
// (never a static page), so the DB-backed container can construct the content
// reads `PingIndexNow` needs directly off the filesystem `ContentSource`.
const contentSource = new FsJsonContentSource();
// SEO advisory engine (seo.md Part 4b). All four are stateless singletons: the
// crawler holds no state between calls, both DataForSEO adapters read their
// credentials per request, and the corpus repository borrows the shared Mongo
// client's pool.
//
// The crawler is Playwright-backed: pages behind a JS challenge (jawetzel's own
// `proxy.ts` cookie gate) or client-rendered content are invisible to a plain
// fetch, and the fact sheet is only as good as the DOM we can read. The browser
// is a lazily-launched process singleton reused across requests.
// `HttpPageCrawlGateway` remains available as a no-browser fallback.
const pageCrawlGateway = new PlaywrightPageCrawlGateway();
const serpGateway = new DataForSeoSerpGateway();
const keywordMetricsGateway = new DataForSeoKeywordMetricsGateway();
const rankedKeywordsGateway = new DataForSeoRankedKeywordsGateway();
// Layer 1 of the funnel. Distinct from `rankedKeywordsGateway`, which answers
// "what does this one domain rank for": this answers "who competes across this
// keyword set", which no number of single-SERP observations gives you without
// paying for all of them.
const serpCompetitorsGateway = new DataForSeoSerpCompetitorsGateway();
// Layer 2. `intersections: false` asks the vendor for "they rank, we don't"
// directly, rather than set-differencing two row-capped `ranked_keywords`
// pulls — which invents gaps whenever our own side is truncated.
const domainIntersectionGateway = new DataForSeoDomainIntersectionGateway();
const seoCorpus = new MongoSeoCorpusRepository();
// Derived run history (seo.md `page_analysis`) — regenerable from the corpus,
// so writes are best-effort and reads power the admin surface's "recent runs".
const seoAnalyses = new MongoSeoAnalysisRepository();
// Customer tags and their intel runs. Unlike the corpus this never pools: it is
// the workspace — which engagements exist, which keyword lists were submitted,
// which competitors a human approved.
const seoWorkspace = new MongoSeoWorkspaceRepository();
// Layer 2's pile, keyed (tag, keyword) and merged rather than replaced — a
// refresh must not resurrect keywords a human already rejected.
const seoGaps = new MongoSeoGapRepository();
// Layer 4a's verdicts, one row per (tag, pageUrl, keyword). Never pruned: the
// backlog is set math over the whole table, so dropping old rows would quietly
// shrink the denominator that makes it trustworthy.
const seoRoutings = new MongoSeoRoutingRepository();

// Project pages don't carry their own modification date, so all projects share
// a single date bumped manually when the JSON catalog changes (mirrors the
// sitemap). Lifted verbatim from the flat indexnow-ping job.
const PROJECT_BASELINE_DATE = "2026-04-13";

export interface Container {
  submitContactInquiry: SubmitContactInquiry;
  requestMagicLink: RequestMagicLink;
  consumeMagicLink: ConsumeMagicLink;
  findOrCreateGoogleUser: FindOrCreateGoogleUser;
  notifyEmbroideryReady: NotifyEmbroideryReady;
  authenticateRequest: AuthenticateRequest;
  issueApiKey: IssueApiKey;
  pingIndexNow: PingIndexNow;
  runAssistantTurn: RunAssistantTurn;
  summarizeConversationTitle: SummarizeConversationTitle;
  analyzePage: AnalyzePage;
  listRecentAnalyses: ListRecentAnalyses;
  suggestQueries: SuggestQueries;
  discoverCompetitorQueries: DiscoverCompetitorQueries;
  createSeoTag: CreateSeoTag;
  listSeoTags: ListSeoTags;
  getSeoTag: GetSeoTag;
  startIntelRun: StartIntelRun;
  approveCompetitors: ApproveCompetitors;
  getIntelRun: GetIntelRun;
  listIntelRuns: ListIntelRuns;
  buildGapPile: BuildGapPile;
  listGapKeywords: ListGapKeywords;
  setGapStatus: SetGapStatus;
  screenFinalists: ScreenFinalists;
  routePageKeywords: RoutePageKeywords;
  overrideRouting: OverrideRouting;
  listBacklog: ListBacklog;
  renderWorkOrder: RenderWorkOrder;
}

export function createContainer(): Container {
  return {
    submitContactInquiry: createSubmitContactInquiry({
      email: emailSender,
      ownerEmail: process.env.OWNER_EMAIL ?? "jawetzel615@gmail.com",
    }),
    requestMagicLink: createRequestMagicLink({
      tokens: magicLinkTokens,
      email: emailSender,
      baseUrl: process.env.NEXTAUTH_URL ?? "https://jawetzel.com",
    }),
    consumeMagicLink: createConsumeMagicLink({
      tokens: magicLinkTokens,
      users: userRepository,
    }),
    findOrCreateGoogleUser: createFindOrCreateGoogleUser({
      users: userRepository,
    }),
    notifyEmbroideryReady: createNotifyEmbroideryReady({
      email: emailSender,
    }),
    authenticateRequest: createAuthenticateRequest({
      session: sessionGateway,
      apiKey: apiKeyVerifier,
      serviceKey: serviceKeyVerifier,
    }),
    issueApiKey: createIssueApiKey({
      users: userRepository,
      apiKeys: apiKeyVerifier,
    }),
    pingIndexNow: createPingIndexNow({
      log: indexNowLog,
      submitter: indexNowSubmitter,
      getAllProjects: createGetAllProjects({ content: contentSource }),
      staticRoutes: STATIC_ROUTE_DATES,
      projectBaselineDate: PROJECT_BASELINE_DATE,
      baseUrl: SITE.url.replace(/\/$/, ""),
    }),
    runAssistantTurn: createRunAssistantTurn({
      llm: llmGateway,
      conversations: conversationStore,
      dispatchTool,
      tools: toolSchemas as ToolSchema[],
      resolvePageContext,
    }),
    summarizeConversationTitle: createSummarizeConversationTitle({
      llm: llmGateway,
      conversations: conversationStore,
    }),
    analyzePage: createAnalyzePage({
      crawler: pageCrawlGateway,
      serp: serpGateway,
      keywords: keywordMetricsGateway,
      corpus: seoCorpus,
      analyses: seoAnalyses,
    }),
    listRecentAnalyses: createListRecentAnalyses({ analyses: seoAnalyses }),
    suggestQueries: createSuggestQueries({
      crawler: pageCrawlGateway,
      llm: llmGateway,
      keywords: keywordMetricsGateway,
    }),
    discoverCompetitorQueries: createDiscoverCompetitorQueries({
      crawler: pageCrawlGateway,
      serp: serpGateway,
      rankedKeywords: rankedKeywordsGateway,
      corpus: seoCorpus,
    }),
    createSeoTag: createCreateSeoTag({ workspace: seoWorkspace }),
    listSeoTags: createListSeoTags({ workspace: seoWorkspace }),
    getSeoTag: createGetSeoTag({ workspace: seoWorkspace }),
    startIntelRun: createStartIntelRun({
      workspace: seoWorkspace,
      competitors: serpCompetitorsGateway,
      // Injected rather than called inside the use-case so run ids are
      // deterministic under test.
      newId: () => crypto.randomUUID(),
    }),
    approveCompetitors: createApproveCompetitors({ workspace: seoWorkspace }),
    getIntelRun: createGetIntelRun({ workspace: seoWorkspace }),
    listIntelRuns: createListIntelRuns({ workspace: seoWorkspace }),
    buildGapPile: createBuildGapPile({
      workspace: seoWorkspace,
      gaps: seoGaps,
      intersection: domainIntersectionGateway,
      rankedKeywords: rankedKeywordsGateway,
    }),
    listGapKeywords: createListGapKeywords({ gaps: seoGaps }),
    setGapStatus: createSetGapStatus({ gaps: seoGaps }),
    screenFinalists: createScreenFinalists({
      workspace: seoWorkspace,
      gaps: seoGaps,
      serp: serpGateway,
      keywords: keywordMetricsGateway,
      corpus: seoCorpus,
    }),
    // The one place a model touches the pipeline: it classifies topical fit and
    // never produces a number. `improve` is not asked at all — the vendor
    // already told us which of our URLs holds the ranking.
    routePageKeywords: createRoutePageKeywords({
      workspace: seoWorkspace,
      gaps: seoGaps,
      routings: seoRoutings,
      crawler: pageCrawlGateway,
      llm: llmGateway,
    }),
    overrideRouting: createOverrideRouting({ routings: seoRoutings }),
    listBacklog: createListBacklog({ gaps: seoGaps, routings: seoRoutings }),
    // Reads a run that was already paid for and writes prose from its swaps —
    // no SERP, no crawl, no keyword call. Re-rendering is tokens only.
    renderWorkOrder: createRenderWorkOrder({
      analyses: seoAnalyses,
      llm: llmGateway,
    }),
  };
}

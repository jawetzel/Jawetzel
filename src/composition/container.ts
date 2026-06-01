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
import { createGetAllProjects } from "@/application/use-cases/content/get-all-projects";
import { createGetAllPosts } from "@/application/use-cases/content/get-all-posts";
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
      getAllPosts: createGetAllPosts({ content: contentSource }),
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
  };
}

/**
 * Client-side mirrors of the workspace API contract
 * (`src/app/api/seo/API.md`), matching the convention already set by
 * `./types.ts`: the client tree never imports the server DTOs from
 * `application/` — its only contract is the JSON these endpoints return.
 */

export interface SeoTagView {
  tag: string;
  label: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  entitySchema: string[];
  urgencyTerms: string[];
  city: string | null;
  createdAt: string;
}

export interface CompetitorRowView {
  domain: string;
  /** Share of the submitted keyword set this domain ranks for, 0–1. */
  share: number;
  intersections: number;
  avgPosition: number | null;
  medianPosition: number | null;
  visibility: number | null;
  estimatedTraffic: number | null;
}

export interface CompetitorStageView {
  rows: CompetitorRowView[];
  capturedAt: string;
  cost: number;
  keywordCount: number;
}

export type IntelRunStatusView =
  | "draft"
  | "competitors_pending"
  | "competitors_approved"
  | "gaps_ready";

export type GapBucketView = "improve" | "gap";
export type GapStatusView = "new" | "accepted" | "rejected";

export interface CompetitorHoldView {
  domain: string;
  position: number;
  url: string | null;
}

export interface ScreeningFactsView {
  resultCount: number;
  ugcResults: number;
  directoryResults: number;
  titleTermCoverage: number;
  distinctDomains: number;
  knownCompetitors: string[];
  features: string[];
  ourPosition: number | null;
}

export interface ScreeningView {
  capturedAt: string;
  weaknessScore: number;
  facts: ScreeningFactsView;
}

export type RouteVerdictView = "improve" | "enrich" | "create";

export interface RoutingView {
  tag: string;
  pageUrl: string;
  keyword: string;
  verdict: RouteVerdictView;
  rationale: string | null;
  overridden: boolean;
  routedAt: string;
}

export interface RoutePageResponse {
  tag: string;
  pageUrl: string;
  pageTitle: string | null;
  counts: Record<RouteVerdictView, number>;
  ownedElsewhere: number;
  preserved: number;
  routings: RoutingView[];
  durationMs?: number;
}

export interface BacklogResponse {
  tag: string;
  rows: GapKeywordView[];
  coverage: {
    pagesRouted: number;
    keywordsClaimed: number;
    keywordsAccepted: number;
  };
}

export interface ScreenResponse {
  tag: string;
  screened: number;
  skipped: number;
  failed: number;
  remaining: number;
  fromCorpus: number;
  cost: number;
  rows: GapKeywordView[];
  durationMs?: number;
}

export interface GapKeywordView {
  tag: string;
  keyword: string;
  location: string;
  bucket: GapBucketView;
  status: GapStatusView;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  ourPosition: number | null;
  ourUrl: string | null;
  competitors: CompetitorHoldView[];
  /** Layer 3's output. Null until this keyword has been screened. */
  screening: ScreeningView | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface GapPileResponse {
  tag: string;
  rows: GapKeywordView[];
  counts: Record<GapStatusView, number>;
}

export interface BuildGapPileResponse {
  run: IntelRunView;
  added: number;
  refreshed: number;
  improveRows: number;
  gapRows: number;
  competitors: Array<{ domain: string; rows: number; failed: boolean }>;
  cost: number;
  durationMs?: number;
}

export interface IntelRunView {
  runId: string;
  tag: string;
  keywords: string[];
  locationCode: number;
  languageCode: string;
  status: IntelRunStatusView;
  createdAt: string;
  updatedAt: string;
  competitors: CompetitorStageView | null;
  /** Null until the layer-1 gate is passed; `[]` means "none approved". */
  approvedCompetitors: string[] | null;
}

export interface StartRunResponse {
  run: IntelRunView;
  cost: number;
  /** Domains observed before minShare and the cap trimmed them. */
  observed: number;
  durationMs?: number;
}

export interface FieldErrorView {
  field: string;
  message: string;
}

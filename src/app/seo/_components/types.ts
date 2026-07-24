/**
 * Client-side mirrors of the SEO API contracts (src/app/api/seo/API.md).
 * Deliberately re-declared rather than imported from the server DTOs — the
 * client tree never reaches into `application/`; its only server contract is
 * the JSON these routes return.
 */

export type TermCount = { term: string; in: number; of: number };

export type SwapArea =
  | "title"
  | "meta"
  | "headings"
  | "facts"
  | "entities"
  | "questions"
  | "schema"
  | "links"
  | "length";

export interface Swap {
  area: SwapArea;
  current: string | string[] | number | null;
  currentScore: number;
  suggested?: string[] | number;
  suggestedScore: number;
  signals?: {
    terms?: TermCount[];
    patterns?: TermCount[];
    lengthMedian?: number;
    examples?: string[];
  };
  provenance?: TermCount[];
}

export interface Sample {
  competitors: number;
  crawled: number;
  crawlFailures: number;
  serpCapturedAt: string;
  serpFromCorpus: boolean;
  ourPosition: number | null;
  features: string[];
}

export interface AnalyzeResponse {
  url: string;
  query: string;
  location: string;
  analyzedAt: string;
  formulaVersion: string;
  swaps: Swap[];
  /** Echoed on a live run; absent when re-displaying a stored run from history. */
  thresholds?: { minShare: number; maxSnapshotAgeDays: number };
  sample: Sample;
  history?: unknown;
  serp?: unknown;
  facts?: unknown;
  keywords?: unknown;
  durationMs?: number;
}

/** One suggested target query from the LLM + DataForSEO helper. */
export interface QueryCandidate {
  query: string;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
  score: number;
  grounded: boolean;
}

/** One stored run from the server-side history (SeoAnalysisRepository). */
export interface HistoryItem {
  url: string;
  query: string;
  location: string;
  runAt: string;
  formulaVersion: string;
  swaps: Swap[];
  sample: Sample;
}

export type FieldError = { field: string; message: string };

/** One competitor-won query from `POST /api/seo/competitor-queries`. */
export interface CompetitorSuggestion {
  query: string;
  score: number;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
  competitorCount: number;
  bestPosition: number;
  domains: string[];
}

/** One SERP domain the discover endpoint pulled rankings for. */
export interface CompetitorSource {
  domain: string;
  serpPosition: number;
  keywordsSampled: number;
  totalKeywords: number | null;
  fromCorpus: boolean;
  failed: boolean;
}

export interface DiscoverResponse {
  url: string;
  targetQuery: string;
  location: string;
  analyzedAt: string;
  suggestions: CompetitorSuggestion[];
  competitors: CompetitorSource[];
  sample: {
    serpCapturedAt: string;
    serpFromCorpus: boolean;
    competitorsRequested: number;
    competitorsWithData: number;
  };
  durationMs?: number;
}

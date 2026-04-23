/** Shared client-side types for the portfolio assistant UI. Mirrors the
 *  response shapes from /api/chat and /api/chat/conversations/... */

export interface ToolResultPayload {
  tool: string;
  data: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  pageUrl?: string;
  toolResults?: ToolResultPayload[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendResponse {
  conversationId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  title?: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

/* ── Tool result shapes (mirror server-side tools) ────────────────────── */

export interface ThreadMatchTile {
  hex: string;
  color_name: string | null;
  color_number: string;
  brand: string;
  manufacturer: string | null;
  shopping_source: string;
  length_yds: number | null;
  distance: number;
  cheapest_price: number | null;
  cheapest_vendor: string | null;
  deep_link: string;
}

export interface FindThreadColorResult {
  reference_hex: string;
  tolerance: number;
  matches: ThreadMatchTile[];
  note?: string;
}

export interface BlogHit {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  kind: string;
  url: string;
}

export interface SearchBlogResult {
  query: string | null;
  tag: string | null;
  total: number;
  posts: BlogHit[];
}

export interface ProjectHit {
  slug: string;
  name: string;
  tagline: string;
  stack: string[];
  status: string | null;
  featured: boolean;
  external_url: string | null;
  url: string;
  brief: string;
}

export interface SearchProjectsResult {
  query: string | null;
  total: number;
  projects: ProjectHit[];
}

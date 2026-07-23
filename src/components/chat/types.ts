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
  brand: string;             // manufacturer ("Madeira", "Fil-Tec", "Isacord", ...)
  product_line: string;      // line within brand ("Polyneon 40", "Glide 40wt", ...)
  material: string;
  length_yds: number;
  distance: number;
  cheapest_price: number | null;
  cheapest_shopping_source: string | null;
  deep_link: string;
}

export interface FindThreadColorResult {
  reference_hex: string;
  tolerance: number;
  matches: ThreadMatchTile[];
  note?: string;
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

export interface BookConsultResult {
  url: string;
  duration_minutes: number;
  topic: string | null;
  email: string;
  note: string;
}

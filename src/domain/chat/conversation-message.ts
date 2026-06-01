/**
 * The persisted shape of one portfolio-assistant message. Pure data — no I/O,
 * no Mongo types. Storage is user/assistant-only (the transient tool_call /
 * tool message pairs never round-trip through Mongo); the `toolResults` array
 * on a stored assistant message carries the UI-renderable tool payloads.
 *
 * This is the single source of truth for the message shape. `lib/ai/conversations`
 * re-exports it so the chat routes' imports are unchanged, and the
 * `ConversationStore` port + the chat use-cases consume it directly.
 */
export interface ToolResultPayload {
  tool: string;
  data: unknown;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  pageUrl?: string;
  toolResults?: ToolResultPayload[];
  createdAt: Date;
}

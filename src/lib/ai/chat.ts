/**
 * Portfolio assistant — thin wrapper kept at its historic import path so the
 * chat routes are unchanged. The tool loop and the title summarizer now live in
 * the hexagon as use-cases:
 *
 * - `RunAssistantTurn` (`application/use-cases/chat/run-assistant-turn.ts`)
 * - `SummarizeConversationTitle`
 *   (`application/use-cases/chat/summarize-conversation-title.ts`)
 *
 * both behind `LlmGateway.createChatCompletion` (the OpenAI SDK is fully
 * isolated in `infrastructure/llm/OpenAiChatGateway` — `chat.ts` no longer
 * imports `openai`) and `ConversationStore` (Mongo persistence). These wrappers
 * resolve the use-cases from the DB-backed container and adapt the `ObjectId`
 * conversation id (still the route's contract) to the string id the ports use.
 *
 * Storage shape is user/assistant-only (see `conversations.ts`). The live
 * message array is rebuilt per turn inside the use-case; tool_call / tool pairs
 * are transient and don't round-trip through Mongo — the `toolResults` array on
 * the stored assistant message carries the UI-renderable payloads.
 */

import type { ObjectId } from "mongodb";

import { createContainer } from "@/composition/container";
import { type ConversationMessage } from "./conversations";

export interface RunAssistantTurnInput {
  conversationId: ObjectId;
  /** Full stored history INCLUDING the latest user message. */
  history: ConversationMessage[];
  pageUrl: string;
}

/**
 * Execute one assistant turn: call the LLM, run any tool calls, loop on
 * tool_call responses, persist the final assistant message, and return it.
 */
export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<ConversationMessage> {
  return createContainer().runAssistantTurn.execute({
    conversationId: input.conversationId.toString(),
    history: input.history,
    pageUrl: input.pageUrl,
  });
}

/**
 * Generate and persist a short conversation title. Call after the first
 * assistant reply lands, not on every turn.
 */
export async function summarizeAndSetTitle(input: {
  conversationId: ObjectId;
  userText: string;
  assistantText: string;
}): Promise<string> {
  return createContainer().summarizeConversationTitle.execute({
    conversationId: input.conversationId.toString(),
    userText: input.userText,
    assistantText: input.assistantText,
  });
}

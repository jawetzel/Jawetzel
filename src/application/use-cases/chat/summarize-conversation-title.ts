/**
 * SummarizeConversationTitle — generate and persist a short conversation title,
 * lifted from the flat `lib/ai/chat.summarizeAndSetTitle` verbatim and rewired
 * onto the {@link LlmGateway} (the same `createChatCompletion` method the loop
 * uses, here with `responseFormatJson: true`, no tools, `maxCompletionTokens`
 * 60, `temperature` 0.3) and the {@link ConversationStore.setTitle} port.
 *
 * Behavior is identical: the same system + user messages, the same JSON parse
 * of `{ title }`, the `"New conversation"` fallback, the trim + 60-char clamp,
 * and the `setTitle` persist. The model gets only the first user/assistant
 * exchange to keep the summary aligned with the opening ask.
 */

import { type LlmGateway } from "@/application/ports/llm-gateway";
import { type ConversationStore } from "@/application/ports/conversation-store";
import { CHAT_MODEL } from "./run-assistant-turn";

const MAX_TITLE_CHARS = 60;

const TITLE_SYSTEM_PROMPT =
  'Return ONLY a JSON object of the form { "title": "..." }. The title is a short label for a conversation thread — max 60 characters, no trailing period, no quotes around the whole thing, Title Case or sentence case, describe the subject not the question. Example: user asks \'Has Joshua worked with Next.js?\' → { "title": "Next.js experience" }.';

export interface SummarizeConversationTitleInput {
  /** Conversation id as a string (the driving adapter converts the ObjectId). */
  conversationId: string;
  userText: string;
  assistantText: string;
}

export interface SummarizeConversationTitleDeps {
  llm: LlmGateway;
  conversations: ConversationStore;
}

export interface SummarizeConversationTitle {
  execute(input: SummarizeConversationTitleInput): Promise<string>;
}

export function createSummarizeConversationTitle(
  deps: SummarizeConversationTitleDeps,
): SummarizeConversationTitle {
  const { llm, conversations } = deps;

  return {
    async execute(input) {
      const result = await llm.createChatCompletion({
        model: CHAT_MODEL,
        temperature: 0.3,
        maxCompletionTokens: 60,
        responseFormatJson: true,
        messages: [
          { role: "system", content: TITLE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `User: ${input.userText}\n\nAssistant: ${input.assistantText}`,
          },
        ],
      });

      const raw = result.content ?? "";
      let title = "New conversation";
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.title === "string" && parsed.title.trim()) {
          title = parsed.title.trim().slice(0, MAX_TITLE_CHARS);
        }
      } catch {
        // fall back
      }
      await conversations.setTitle(input.conversationId, title);
      return title;
    },
  };
}

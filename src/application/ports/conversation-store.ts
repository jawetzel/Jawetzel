import { type ConversationMessage } from "@/domain/chat/conversation-message";

/**
 * ConversationStore — a driven port for persisting portfolio-assistant
 * conversation state. Consumer-owned and shaped to exactly what the chat
 * use-cases need: append the final assistant message of a turn, and set a
 * conversation's title once it has been summarized.
 *
 * The conversation id crosses the boundary as a **string** (no Mongo `ObjectId`
 * leaks into the application/domain layers); the driving adapter converts the
 * request's id to a string before calling a use-case. The Mongo adapter
 * (`MongoConversationStore`) wraps `lib/ai/conversations`'s `appendMessage` /
 * `setTitle`, which accept a string id.
 *
 * The read side of conversations (create / fetch / list / claim / delete) stays
 * flat in the chat routes for now — only the two writes the assistant loop and
 * the titler perform are inverted here. See
 * `docs/architecture/external-services.md` → the chat tool loop.
 */
export interface ConversationStore {
  /** Append one message to a conversation and bump its `updatedAt`. */
  appendMessage(
    conversationId: string,
    message: ConversationMessage,
  ): Promise<void>;

  /** Set a conversation's title and bump its `updatedAt`. */
  setTitle(conversationId: string, title: string): Promise<void>;
}

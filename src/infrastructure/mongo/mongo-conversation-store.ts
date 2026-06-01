import {
  appendMessage as appendMessageDoc,
  setTitle as setTitleDoc,
} from "@/lib/ai/conversations";
import { type ConversationMessage } from "@/domain/chat/conversation-message";
import { type ConversationStore } from "@/application/ports/conversation-store";

/**
 * MongoConversationStore — the production {@link ConversationStore}, delegating
 * to the unchanged `lib/ai/conversations` writes (`appendMessage` / `setTitle`).
 * Those helpers own the `conversations` collection, the index bootstrap, and the
 * `$push` / `$set updatedAt` semantics; this adapter is a thin pass-through that
 * accepts the string id the port exposes (the underlying helpers already accept
 * `string | ObjectId`). The read side of `lib/ai/conversations` stays flat in
 * the chat routes for now.
 */
export class MongoConversationStore implements ConversationStore {
  async appendMessage(
    conversationId: string,
    message: ConversationMessage,
  ): Promise<void> {
    await appendMessageDoc(conversationId, message);
  }

  async setTitle(conversationId: string, title: string): Promise<void> {
    await setTitleDoc(conversationId, title);
  }
}

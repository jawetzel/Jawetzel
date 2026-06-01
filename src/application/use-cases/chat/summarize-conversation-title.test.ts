import { describe, it, expect } from "vitest";

import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import { type ConversationStore } from "@/application/ports/conversation-store";
import { type ConversationMessage } from "@/domain/chat/conversation-message";
import { createSummarizeConversationTitle } from "./summarize-conversation-title";

class FakeConversationStore implements ConversationStore {
  readonly titles: { id: string; title: string }[] = [];
  async appendMessage(_id: string, _m: ConversationMessage): Promise<void> {}
  async setTitle(id: string, title: string): Promise<void> {
    this.titles.push({ id, title });
  }
}

function chatResult(content: string | null) {
  return {
    hasChoice: true,
    content,
    toolCalls: [] as never[],
    finishReason: "stop",
  };
}

describe("SummarizeConversationTitle", () => {
  it("requests a JSON-object completion with the title params and no tools", async () => {
    const llm = new FakeLlmGateway();
    llm.chatResponses = [chatResult('{"title":"Next.js experience"}')];
    const store = new FakeConversationStore();

    const title = await createSummarizeConversationTitle({
      llm,
      conversations: store,
    }).execute({
      conversationId: "c1",
      userText: "Has Joshua worked with Next.js?",
      assistantText: "Yes, extensively.",
    });

    expect(title).toBe("Next.js experience");
    const req = llm.chatRequests[0];
    expect(req.model).toBe("gpt-5.4-mini");
    expect(req.temperature).toBe(0.3);
    expect(req.maxCompletionTokens).toBe(60);
    expect(req.responseFormatJson).toBe(true);
    expect(req.tools).toBeUndefined();
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[1]).toEqual({
      role: "user",
      content:
        "User: Has Joshua worked with Next.js?\n\nAssistant: Yes, extensively.",
    });
    expect(store.titles).toEqual([{ id: "c1", title: "Next.js experience" }]);
  });

  it("trims and clamps the parsed title to 60 chars", async () => {
    const llm = new FakeLlmGateway();
    const long = "x".repeat(80);
    llm.chatResponses = [chatResult(`{"title":"  ${long}  "}`)];
    const store = new FakeConversationStore();

    const title = await createSummarizeConversationTitle({
      llm,
      conversations: store,
    }).execute({ conversationId: "c2", userText: "u", assistantText: "a" });

    expect(title).toBe("x".repeat(60));
    expect(title).toHaveLength(60);
    expect(store.titles[0].title).toBe("x".repeat(60));
  });

  it("falls back to 'New conversation' on unparseable content", async () => {
    const llm = new FakeLlmGateway();
    llm.chatResponses = [chatResult("not json at all")];
    const store = new FakeConversationStore();

    const title = await createSummarizeConversationTitle({
      llm,
      conversations: store,
    }).execute({ conversationId: "c3", userText: "u", assistantText: "a" });

    expect(title).toBe("New conversation");
    expect(store.titles[0].title).toBe("New conversation");
  });

  it("falls back when the parsed title is empty/whitespace", async () => {
    const llm = new FakeLlmGateway();
    llm.chatResponses = [chatResult('{"title":"   "}')];
    const store = new FakeConversationStore();

    const title = await createSummarizeConversationTitle({
      llm,
      conversations: store,
    }).execute({ conversationId: "c4", userText: "u", assistantText: "a" });

    expect(title).toBe("New conversation");
  });

  it("falls back when content is null (no choice content)", async () => {
    const llm = new FakeLlmGateway();
    llm.chatResponses = [chatResult(null)];
    const store = new FakeConversationStore();

    const title = await createSummarizeConversationTitle({
      llm,
      conversations: store,
    }).execute({ conversationId: "c5", userText: "u", assistantText: "a" });

    expect(title).toBe("New conversation");
    expect(store.titles[0]).toEqual({ id: "c5", title: "New conversation" });
  });
});

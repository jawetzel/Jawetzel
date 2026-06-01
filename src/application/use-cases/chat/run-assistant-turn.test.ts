import { describe, it, expect, vi } from "vitest";

import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import {
  type CreateChatCompletionResult,
  type ToolSchema,
} from "@/application/ports/llm-gateway";
import { type ConversationStore } from "@/application/ports/conversation-store";
import { type ConversationMessage } from "@/domain/chat/conversation-message";
import {
  createRunAssistantTurn,
  type RunAssistantTurnDeps,
} from "./run-assistant-turn";

/** Records every persisted message so the test can assert the stored shape. */
class FakeConversationStore implements ConversationStore {
  readonly appended: { id: string; message: ConversationMessage }[] = [];
  readonly titles: { id: string; title: string }[] = [];

  async appendMessage(id: string, message: ConversationMessage): Promise<void> {
    this.appended.push({ id, message });
  }
  async setTitle(id: string, title: string): Promise<void> {
    this.titles.push({ id, title });
  }
}

const TOOLS: ToolSchema[] = [
  { type: "function", function: { name: "search_projects" } },
];

function stop(content: string): CreateChatCompletionResult {
  return { hasChoice: true, content, toolCalls: [], finishReason: "stop" };
}

function toolTurn(
  calls: { id: string; name: string; arguments: string }[],
): CreateChatCompletionResult {
  return {
    hasChoice: true,
    content: null,
    toolCalls: calls.map((c) => ({ type: "function" as const, ...c })),
    finishReason: "tool_calls",
  };
}

function makeDeps(
  overrides: Partial<RunAssistantTurnDeps> = {},
): { deps: RunAssistantTurnDeps; llm: FakeLlmGateway; store: FakeConversationStore } {
  const llm = new FakeLlmGateway();
  const store = new FakeConversationStore();
  const deps: RunAssistantTurnDeps = {
    llm,
    conversations: store,
    dispatchTool: vi.fn(async () => ({ ok: true })),
    tools: TOOLS,
    resolvePageContext: async () => null,
    ...overrides,
  };
  return { deps, llm, store };
}

const HISTORY: ConversationMessage[] = [
  { role: "user", content: "Tell me about Next.js work", createdAt: new Date() },
];

describe("RunAssistantTurn", () => {
  it("returns immediately on a no-tool response and persists it", async () => {
    const { deps, llm, store } = makeDeps();
    llm.chatResponses = [stop("Here is the answer.")];

    const result = await createRunAssistantTurn(deps).execute({
      conversationId: "conv1",
      history: HISTORY,
      pageUrl: "",
    });

    expect(llm.chatRequests).toHaveLength(1);
    expect(result.role).toBe("assistant");
    expect(result.content).toBe("Here is the answer.");
    expect(result.toolResults).toBeUndefined();
    expect(result.createdAt).toBeInstanceOf(Date);
    // appended exactly once, with the same message object that was returned
    expect(store.appended).toHaveLength(1);
    expect(store.appended[0]).toEqual({ id: "conv1", message: result });
  });

  it("dispatches a tool_call, appends the tool result, loops, and returns the final message with toolResults", async () => {
    const dispatchTool = vi.fn(async () => ({ hits: ["a", "b"] }));
    const { deps, llm, store } = makeDeps({ dispatchTool });
    llm.chatResponses = [
      toolTurn([
        { id: "call_1", name: "search_projects", arguments: '{"q":"next"}' },
      ]),
      stop("Two projects matched."),
    ];

    const result = await createRunAssistantTurn(deps).execute({
      conversationId: "conv2",
      history: HISTORY,
      pageUrl: "",
    });

    // looped: two LLM calls
    expect(llm.chatRequests).toHaveLength(2);
    // tool dispatched with the model's name + raw args
    expect(dispatchTool).toHaveBeenCalledExactlyOnceWith(
      "search_projects",
      '{"q":"next"}',
    );

    // the SECOND request must carry the assistant tool-call turn + the matching
    // tool result, in order — the round-trip the loop depends on.
    const secondMessages = llm.chatRequests[1].messages;
    const assistant = secondMessages.at(-2);
    const toolMsg = secondMessages.at(-1);
    expect(assistant).toMatchObject({
      role: "assistant",
      content: null,
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          name: "search_projects",
          arguments: '{"q":"next"}',
        },
      ],
    });
    expect(toolMsg).toEqual({
      role: "tool",
      toolCallId: "call_1",
      content: JSON.stringify({ hits: ["a", "b"] }),
    });

    // final assistant message carries the accumulated toolResults
    expect(result.content).toBe("Two projects matched.");
    expect(result.toolResults).toEqual([
      { tool: "search_projects", data: { hits: ["a", "b"] } },
    ]);
    expect(store.appended).toHaveLength(1);
    expect(store.appended[0].message).toBe(result);
  });

  it("emits an error tool result when dispatch throws but does not add to toolResults", async () => {
    const dispatchTool = vi.fn(async () => {
      throw new Error("boom");
    });
    const { deps, llm } = makeDeps({ dispatchTool });
    llm.chatResponses = [
      toolTurn([{ id: "c1", name: "search_blog", arguments: "{}" }]),
      stop("Recovered."),
    ];

    const result = await createRunAssistantTurn(deps).execute({
      conversationId: "conv3",
      history: HISTORY,
      pageUrl: "",
    });

    const toolMsg = llm.chatRequests[1].messages.at(-1);
    expect(toolMsg).toEqual({
      role: "tool",
      toolCallId: "c1",
      content: JSON.stringify({ error: "boom" }),
    });
    // a thrown tool does not become a rendered toolResult
    expect(result.toolResults).toBeUndefined();
    expect(result.content).toBe("Recovered.");
  });

  it("returns the fallback message after the 4-iteration cap", async () => {
    const dispatchTool = vi.fn(async () => ({ ok: true }));
    const { deps, llm, store } = makeDeps({ dispatchTool });
    // four straight tool-call turns => never resolves => cap hit
    llm.chatResponses = [
      toolTurn([{ id: "c1", name: "search_projects", arguments: "{}" }]),
      toolTurn([{ id: "c2", name: "search_projects", arguments: "{}" }]),
      toolTurn([{ id: "c3", name: "search_projects", arguments: "{}" }]),
      toolTurn([{ id: "c4", name: "search_projects", arguments: "{}" }]),
    ];

    const result = await createRunAssistantTurn(deps).execute({
      conversationId: "conv4",
      history: HISTORY,
      pageUrl: "",
    });

    expect(llm.chatRequests).toHaveLength(4);
    expect(result.content).toContain("tool-loop limit");
    // all four tool results accumulated onto the fallback
    expect(result.toolResults).toHaveLength(4);
    expect(store.appended).toHaveLength(1);
    expect(store.appended[0].message).toBe(result);
  });

  it("falls through to the fallback when the model returns no choice", async () => {
    const { deps, llm } = makeDeps();
    llm.chatResponses = [
      { hasChoice: false, content: null, toolCalls: [], finishReason: "stop" },
    ];

    const result = await createRunAssistantTurn(deps).execute({
      conversationId: "conv5",
      history: HISTORY,
      pageUrl: "",
    });

    // no-choice breaks the loop -> fallback, not an empty answer
    expect(result.content).toContain("tool-loop limit");
    expect(llm.chatRequests).toHaveLength(1);
  });

  it("answers an unsupported tool-call type without dispatching, then continues", async () => {
    const dispatchTool = vi.fn(async () => ({ ok: true }));
    const { deps, llm } = makeDeps({ dispatchTool });
    llm.chatResponses = [
      {
        hasChoice: true,
        content: null,
        toolCalls: [{ id: "x1", type: "other", name: "", arguments: "" }],
        finishReason: "tool_calls",
      },
      stop("Done."),
    ];

    const result = await createRunAssistantTurn(deps).execute({
      conversationId: "conv6",
      history: HISTORY,
      pageUrl: "",
    });

    expect(dispatchTool).not.toHaveBeenCalled();
    const toolMsg = llm.chatRequests[1].messages.at(-1);
    expect(toolMsg).toEqual({
      role: "tool",
      toolCallId: "x1",
      content: JSON.stringify({ error: "Unsupported tool call type" }),
    });
    expect(result.content).toBe("Done.");
  });

  it("builds the system prompt + page context + the windowed history", async () => {
    const { deps, llm } = makeDeps({
      resolvePageContext: async () => "On the resume page.",
    });
    llm.chatResponses = [stop("ok")];

    await createRunAssistantTurn(deps).execute({
      conversationId: "conv7",
      history: [
        { role: "user", content: "u1", createdAt: new Date() },
        { role: "assistant", content: "a1", createdAt: new Date() },
        { role: "user", content: "u2", createdAt: new Date() },
      ],
      pageUrl: "/resume",
    });

    const msgs = llm.chatRequests[0].messages;
    expect(msgs[0]).toMatchObject({ role: "system" });
    expect((msgs[0] as { content: string }).content).toContain(
      "assistant embedded in Joshua Wetzel's portfolio site",
    );
    expect(msgs[1]).toEqual({
      role: "system",
      content: "[Current page context]\nOn the resume page.",
    });
    expect(msgs.slice(2)).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
    // the loop request offers the tool catalogue + the chat params verbatim
    expect(llm.chatRequests[0].model).toBe("gpt-5.4-mini");
    expect(llm.chatRequests[0].temperature).toBe(0.7);
    expect(llm.chatRequests[0].maxCompletionTokens).toBe(1500);
    expect(llm.chatRequests[0].tools).toBe(TOOLS);
  });
});

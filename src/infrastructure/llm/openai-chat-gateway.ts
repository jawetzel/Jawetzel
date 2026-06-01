import OpenAI from "openai";

import {
  type ChatMessage,
  type CreateChatCompletionRequest,
  type CreateChatCompletionResult,
  type GenerateJsonFromImageRequest,
  type LlmGateway,
  type ToolCall,
} from "@/application/ports/llm-gateway";

/**
 * OpenAiChatGateway — the production {@link LlmGateway}, backed by the OpenAI
 * `chat.completions` API. It is the **sole module in the app that imports the
 * `openai` SDK**: both the embroidery-AI path ({@link generateJsonFromImage})
 * and the portfolio-assistant tool loop ({@link createChatCompletion}) issue
 * their `create()` calls here, and all OpenAI ↔ domain mapping lives in this
 * file. No OpenAI types leak across the port boundary.
 *
 * `getClient()` reads `OPENAI_API_KEY` per call and constructs the client (the
 * old `lib/ai/client.getOpenAI` moved here verbatim when `chat.ts` migrated off
 * it — that helper and file are now gone). Construction is cheap; the SDK reuses
 * its underlying connection pool.
 *
 * See `docs/architecture/external-services.md` → OpenAI.
 */
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({ apiKey });
}

/**
 * Map a domain {@link ChatMessage} to the OpenAI message param. The assistant
 * branch re-attaches `toolCalls` (as `tool_calls`) so a tool-call turn pushed
 * back into the next request is seen by the model; the tool branch addresses
 * the result by `tool_call_id`. Only `"function"`-type tool calls are
 * re-attached — an `"other"` call never round-trips (the loop has already
 * answered it with an error tool message), so it is dropped here, leaving the
 * assistant message with only its function calls.
 */
function toOpenAiMessage(
  m: ChatMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    case "assistant": {
      const functionCalls = (m.toolCalls ?? []).filter(
        (tc) => tc.type === "function",
      );
      const out: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: m.content,
      };
      if (functionCalls.length > 0) {
        out.tool_calls = functionCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return out;
    }
  }
}

/**
 * Map one OpenAI tool call back to the domain {@link ToolCall}. A non-function
 * (custom) tool call becomes `type: "other"` with empty name/arguments,
 * preserving the historic `tc.type !== "function"` "Unsupported tool call type"
 * branch.
 */
function toDomainToolCall(
  tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): ToolCall {
  if (tc.type === "function") {
    return {
      id: tc.id,
      type: "function",
      name: tc.function.name,
      arguments: tc.function.arguments,
    };
  }
  return { id: tc.id, type: "other", name: "", arguments: "" };
}

export class OpenAiChatGateway implements LlmGateway {
  async generateJsonFromImage(
    request: GenerateJsonFromImageRequest,
  ): Promise<string> {
    const { model, temperature, systemPrompt, userText, imageUrl } = request;
    const client = getClient();
    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "";
  }

  async createChatCompletion(
    request: CreateChatCompletionRequest,
  ): Promise<CreateChatCompletionResult> {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: request.model,
      temperature: request.temperature,
      max_completion_tokens: request.maxCompletionTokens,
      messages: request.messages.map(toOpenAiMessage),
      ...(request.tools && {
        tools: request.tools as OpenAI.Chat.Completions.ChatCompletionTool[],
      }),
      ...(request.responseFormatJson && {
        response_format: { type: "json_object" as const },
      }),
    });

    const choice = response.choices[0];
    if (!choice) {
      return {
        hasChoice: false,
        content: null,
        toolCalls: [],
        finishReason: "stop",
      };
    }

    return {
      hasChoice: true,
      content: choice.message.content ?? null,
      toolCalls: (choice.message.tool_calls ?? []).map(toDomainToolCall),
      finishReason: choice.finish_reason ?? "stop",
    };
  }
}

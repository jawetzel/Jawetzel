/**
 * LlmGateway — a driven port for the LLM (large-language-model) capability.
 *
 * Consumer-owned and **domain-shaped**: the two embroidery AI calls
 * (`select-palette` and `tag-svg`) are uniform — a single chat completion with
 * a JSON-object response, a system message, and a user message that pairs one
 * text block with one high-detail image — so this port exposes exactly that one
 * shape and **no OpenAI types leak across the boundary**. A use-case (or a
 * still-flat workflow that will migrate later) says "give me JSON for this
 * image + prompt," never "talk to OpenAI."
 *
 * The production adapter is `infrastructure/llm/OpenAiChatGateway`; a fake
 * (`llm-gateway.fake.ts`) stands in for tests. A provider swap is a single new
 * adapter + one composition edit — exactly the dependency-inversion payoff the
 * `LlmGateway` was introduced to deliver.
 *
 * The richer **chat tool-loop** call (the portfolio assistant in
 * `application/use-cases/chat/*`: a tool catalogue, up to four tool iterations,
 * `max_completion_tokens`) is a different shape and is served by the second
 * method, {@link LlmGateway.createChatCompletion}. Both methods keep all OpenAI
 * types inside the adapter — the DTOs below are domain-shaped.
 *
 * See `docs/architecture/external-services.md` → OpenAI.
 */

/**
 * The one request shape both embroidery AI calls use. All five fields are
 * required and plain primitives — no SDK types.
 */
export interface GenerateJsonFromImageRequest {
  /** Chat model id, e.g. `"gpt-5.4-mini"`. */
  model: string;
  /**
   * Sampling temperature. The two callers differ only here: `select-palette`
   * uses `0` (deterministic palette routing), `tag-svg` uses `0.2`.
   */
  temperature: number;
  /** The system-role message content. */
  systemPrompt: string;
  /** The text block of the user-role message (paired with the image below). */
  userText: string;
  /** The image URL sent alongside `userText` in the user message. */
  imageUrl: string;
}

/**
 * One tool call the model asked for, in domain shape (no OpenAI types). `type`
 * preserves the historic `tc.type !== "function"` branch: only `"function"`
 * calls carry a usable `name`/`arguments`; anything else is `"other"` and the
 * loop emits the "Unsupported tool call type" tool result for it.
 */
export interface ToolCall {
  id: string;
  type: "function" | "other";
  name: string;
  /** Raw JSON-string arguments, exactly as the model emitted them. */
  arguments: string;
}

/**
 * A single message in the chat completion request, domain-shaped. The union
 * mirrors the four OpenAI roles the assistant loop uses:
 * - `system` / `user`: plain string content.
 * - `assistant`: content (possibly `null` when it only made tool calls) plus
 *   optional `toolCalls` — this is how a tool-call turn is pushed back into the
 *   next request so the model sees what it asked for.
 * - `tool`: a tool result, addressed to the assistant's `toolCallId`.
 */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/**
 * A tool/function schema passed straight through to the model. Structurally
 * matches `src/lib/ai/tools/registry.ts`'s `toolSchemas` entries, so they flow
 * through the gateway unchanged — the registry is not modified.
 */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface CreateChatCompletionRequest {
  model: string;
  temperature: number;
  maxCompletionTokens: number;
  messages: ChatMessage[];
  /** Tool catalogue offered to the model; omit for a plain completion. */
  tools?: ToolSchema[];
  /**
   * When `true`, request a JSON-object response
   * (`response_format: { type: "json_object" }`) — used by the title
   * summarizer.
   */
  responseFormatJson?: boolean;
}

/**
 * The assistant turn mapped back out of OpenAI into domain shape. `content` is
 * `null` when the model only made tool calls; `toolCalls` is empty for a plain
 * answer. `finishReason` carries the raw OpenAI value (`"tool_calls"`,
 * `"stop"`, …) so the loop can branch on it exactly as before.
 *
 * `hasChoice` is `false` only when the model returned no choice at all
 * (`response.choices[0]` was undefined). The loop must treat that as the
 * historic `if (!choice) break;` — abandon the loop and fall through to the
 * fallback message — not as an empty answer.
 */
export interface CreateChatCompletionResult {
  hasChoice: boolean;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface LlmGateway {
  /**
   * Run one chat completion for an image + prompt and return the assistant
   * message **content string** verbatim — the caller is responsible for
   * `JSON.parse`-ing and validating it (the parsing/consolidation/validation is
   * domain logic that stays in the consumer).
   *
   * Contract — part of this method, not optional:
   * - the response is requested as a JSON object
   *   (`response_format: { type: "json_object" }`), which both callers rely on
   *   so the returned string is parseable JSON; and
   * - the image is sent at **high** detail (`image_url.detail: "high"`).
   *
   * The user message is structured as a text block followed by the image
   * block. Returns `""` if the model produced no content (mirrors the historic
   * `choices[0]?.message?.content ?? ""` extraction).
   */
  generateJsonFromImage(request: GenerateJsonFromImageRequest): Promise<string>;

  /**
   * Run one chat completion for the **portfolio-assistant tool loop**. Maps the
   * domain {@link ChatMessage}[] to OpenAI's message params (re-attaching an
   * assistant turn's `toolCalls` and addressing `tool` messages by
   * `toolCallId`), calls `chat.completions.create` with the given
   * `model`/`temperature`/`maxCompletionTokens`/`tools`, and maps the chosen
   * message back to {@link CreateChatCompletionResult}.
   *
   * Returns `hasChoice: false` when the model returns no choice (mirrors the
   * historic `if (!choice) break;`). The tool-call round-trip is the crux: the
   * `toolCalls` on the result, pushed back as an assistant message plus matching
   * `tool` messages, must be visible to the next call.
   */
  createChatCompletion(
    request: CreateChatCompletionRequest,
  ): Promise<CreateChatCompletionResult>;
}

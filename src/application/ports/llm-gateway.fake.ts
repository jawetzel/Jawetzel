import {
  type CreateChatCompletionRequest,
  type CreateChatCompletionResult,
  type GenerateJsonFromImageRequest,
  type LlmGateway,
} from "./llm-gateway";

/**
 * FakeLlmGateway — a recording, no-network {@link LlmGateway} for tests. It
 * never talks to OpenAI.
 *
 * `generateJsonFromImage` records each request and returns a canned JSON string
 * so the embroidery AI consumers (`selectPalette`, `askOpenAI`/`tagSvg`) can be
 * unit-tested deterministically — asserting both the request they build and how
 * they parse a canned response.
 *
 * `createChatCompletion` records each request and returns the next scripted
 * {@link CreateChatCompletionResult} from `chatResponses` (a FIFO queue), so the
 * assistant tool loop can be driven turn by turn — e.g. "first a tool_calls
 * turn, then a stop turn." When the queue is exhausted it returns a plain
 * `stop` with empty content (the iteration cap behavior is then exercised by
 * scripting that many tool-call turns).
 */
export class FakeLlmGateway implements LlmGateway {
  readonly requests: GenerateJsonFromImageRequest[] = [];
  readonly chatRequests: CreateChatCompletionRequest[] = [];
  chatResponses: CreateChatCompletionResult[] = [];

  constructor(public cannedResponse: string = "{}") {}

  async generateJsonFromImage(
    request: GenerateJsonFromImageRequest,
  ): Promise<string> {
    this.requests.push(request);
    return this.cannedResponse;
  }

  async createChatCompletion(
    request: CreateChatCompletionRequest,
  ): Promise<CreateChatCompletionResult> {
    this.chatRequests.push(request);
    const next = this.chatResponses.shift();
    return (
      next ?? {
        hasChoice: true,
        content: "",
        toolCalls: [],
        finishReason: "stop",
      }
    );
  }
}

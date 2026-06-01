import { OpenAiChatGateway } from "@/infrastructure/llm/openai-chat-gateway";
import { type LlmGateway } from "@/application/ports/llm-gateway";

/**
 * LLM composition root — wiring for the {@link LlmGateway} port, kept separate
 * from the main `container.ts` on purpose: it imports only the
 * `OpenAiChatGateway` adapter, never the Mongo/Brevo adapters. That matters
 * because `src/lib/mongodb.ts` connects (and throws on a missing
 * `DATABASE_URL`) at import time, and the gateway is reached by the embroidery
 * AI steps (`ai/select-palette.ts`, `ai/tag-svg.ts`) — neither of which needs
 * Mongo. Routing them through the DB-backed container would drag Mongo into
 * those import sites for nothing — a regression.
 *
 * So the gateway gets its own DB-free composition, mirroring
 * `composition/object-store.ts` and `composition/embroidery-compute.ts`
 * (`OpenAiChatGateway` is stateless — it constructs an OpenAI client per request
 * from `OPENAI_API_KEY`, the sole reader of that env var and the sole `openai`
 * SDK touch in the app). The DB-backed `container.ts` reuses this singleton for
 * the chat use-cases (it is the chat loop's `LlmGateway`); the embroidery-AI
 * path reaches it here directly.
 *
 * (Composition may be more than one module — the rule is that adapters are
 * imported *only* in composition, not that there's a single function. Once
 * `mongodb.ts` is made lazy, these could merge.)
 */
const llmGateway: LlmGateway = new OpenAiChatGateway();

export function getLlmGateway(): LlmGateway {
  return llmGateway;
}

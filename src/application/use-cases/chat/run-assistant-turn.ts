/**
 * RunAssistantTurn — the portfolio-assistant tool loop, lifted from the flat
 * `lib/ai/chat.runAssistantTurn` verbatim and rewired onto ports:
 *
 * - the LLM call goes through {@link LlmGateway.createChatCompletion} (the
 *   domain-shaped tool-loop method), so no OpenAI types appear here;
 * - persistence of the final assistant message goes through
 *   {@link ConversationStore.appendMessage};
 * - tools are dispatched through an injected `dispatchTool` + offered as an
 *   injected `tools` catalogue (the unchanged `registry.ts` `toolSchemas`);
 * - page context is resolved through an injected `resolvePageContext`.
 *
 * Behavior is identical to the flat function: same model / temperature /
 * max_completion_tokens, the 50-message context window, BASE_SYSTEM_PROMPT
 * (incl. the tolerance interpolation), the ≤4-iteration cap + fallback message,
 * the finish_reason === "tool_calls" handling, the assistant-message +
 * tool-result round-trip ordering, and the persisted `ConversationMessage`
 * shape (role / content / createdAt / optional toolResults).
 */

import {
  type ChatMessage,
  type CreateChatCompletionResult,
  type LlmGateway,
  type ToolSchema,
} from "@/application/ports/llm-gateway";
import { type ConversationStore } from "@/application/ports/conversation-store";
import {
  type ConversationMessage,
  type ToolResultPayload,
} from "@/domain/chat/conversation-message";
import {
  SUPPLY_DEFAULT_TOLERANCE,
  SUPPLY_TOLERANCE_RETRY_LADDER,
} from "@/domain/embroidery/supply-tolerance";

export const CHAT_MODEL = "gpt-5.4-mini";
const AI_CONTEXT_WINDOW = 50;
const MAX_TOOL_ITERATIONS = 4;

const TOLERANCE_RETRY_HINT = SUPPLY_TOLERANCE_RETRY_LADDER.slice(1).join(
  ", then ",
);

export const BASE_SYSTEM_PROMPT = `You are the assistant embedded in Joshua Wetzel's portfolio site.

Joshua is a Full Stack Software Engineer based near Baton Rouge, LA. The portfolio showcases his projects, resume, and public tools. Your job is to help visitors explore the site and answer questions about Joshua's work.

Your tools:
- search_projects(q, featured_only, limit) — search his portfolio projects
- get_resume(section) — fetch resume by section (summary, experience, education, skills, projects, contact, or all)
- find_thread_color(hex, tolerance) — find real embroidery threads visually close to a target hex, for the /tools/embroidery-supplies comparison tool

Known pages beyond those tools:
- /security-audit is a redacted case study of a zero-knowledge security audit Joshua performed on a mid-size B2B distributor. It surfaced 14 unauthenticated internal dashboards, customer financial statements on a public file-storage bucket, and wholesale cost + live inventory leaked on ~45K products. Not indexed by search_projects — link users there directly when they ask about security work, audits, vulnerability research, or zero-knowledge methodology.

Rules:
- Never invent projects or resume facts — call the tool first.
- For color requests ("something like mauve", "dusty pink", "a warmer forest green"), translate the color language to a hex yourself, then call find_thread_color with that hex. Default tolerance is ${SUPPLY_DEFAULT_TOLERANCE} (tight — only visually near-identical threads). If the first call returns zero matches, retry with a wider tolerance (${TOLERANCE_RETRY_HINT}).
- Tool results render as interactive cards or color tiles in the UI — don't repeat titles, URLs, or a list of names in your prose. Write 1-2 sentences of value-add commentary instead ("The Polyneon match is closest on hue; the Madeira option is a hair warmer.").
- Keep responses terse. One short paragraph, no filler openers like "Great question!".
- If the user asks about topics unrelated to Joshua, the portfolio, or the embroidery-supplies tool, redirect politely ("I can help with Joshua's work or color matching for embroidery threads — anything there I can dig into?").
- Decline to share sensitive personal info beyond what the resume exposes.

Tone: professional, direct, a touch playful. Match Joshua's voice — he ships.`;

function buildMessages(
  allMessages: ConversationMessage[],
  pageContext: string | null,
): ChatMessage[] {
  const window = allMessages.slice(-AI_CONTEXT_WINDOW);
  const out: ChatMessage[] = [{ role: "system", content: BASE_SYSTEM_PROMPT }];
  if (pageContext) {
    out.push({
      role: "system",
      content: `[Current page context]\n${pageContext}`,
    });
  }
  for (const m of window) {
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export interface RunAssistantTurnInput {
  /** Conversation id as a string (the driving adapter converts the ObjectId). */
  conversationId: string;
  /** Full stored history INCLUDING the latest user message. */
  history: ConversationMessage[];
  pageUrl: string;
}

export interface RunAssistantTurnDeps {
  llm: LlmGateway;
  conversations: ConversationStore;
  /** The unchanged `registry.ts` tool dispatcher. */
  dispatchTool(name: string, rawArgs: string): Promise<unknown>;
  /** The unchanged `registry.ts` `toolSchemas`. */
  tools: ToolSchema[];
  /** Resolve page-context for the prompt (wraps the content container reads). */
  resolvePageContext(pageUrl: string): Promise<string | null>;
}

export interface RunAssistantTurn {
  execute(input: RunAssistantTurnInput): Promise<ConversationMessage>;
}

export function createRunAssistantTurn(
  deps: RunAssistantTurnDeps,
): RunAssistantTurn {
  const { llm, conversations, dispatchTool, tools, resolvePageContext } = deps;

  return {
    async execute(input) {
      const pageContext = await resolvePageContext(input.pageUrl);
      const messages = buildMessages(input.history, pageContext);

      const toolResults: ToolResultPayload[] = [];

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const result: CreateChatCompletionResult =
          await llm.createChatCompletion({
            model: CHAT_MODEL,
            temperature: 0.7,
            maxCompletionTokens: 1500,
            messages,
            tools,
          });

        if (!result.hasChoice) break;

        const toolCalls = result.toolCalls;

        if (result.finishReason === "tool_calls" && toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: result.content,
            toolCalls,
          });
          for (const tc of toolCalls) {
            if (tc.type !== "function") {
              messages.push({
                role: "tool",
                toolCallId: tc.id,
                content: JSON.stringify({ error: "Unsupported tool call type" }),
              });
              continue;
            }
            try {
              const data = await dispatchTool(tc.name, tc.arguments);
              toolResults.push({ tool: tc.name, data });
              messages.push({
                role: "tool",
                toolCallId: tc.id,
                content: JSON.stringify(data),
              });
            } catch (err) {
              messages.push({
                role: "tool",
                toolCallId: tc.id,
                content: JSON.stringify({
                  error: err instanceof Error ? err.message : "Tool failed",
                }),
              });
            }
          }
          continue;
        }

        const content = result.content ?? "";
        const assistantMessage: ConversationMessage = {
          role: "assistant",
          content,
          createdAt: new Date(),
          ...(toolResults.length > 0 && { toolResults }),
        };
        await conversations.appendMessage(
          input.conversationId,
          assistantMessage,
        );
        return assistantMessage;
      }

      const fallback: ConversationMessage = {
        role: "assistant",
        content:
          "I hit my tool-loop limit on this one. Could you rephrase, or narrow the request?",
        createdAt: new Date(),
        ...(toolResults.length > 0 && { toolResults }),
      };
      await conversations.appendMessage(input.conversationId, fallback);
      return fallback;
    },
  };
}

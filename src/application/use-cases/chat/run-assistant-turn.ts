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
 * Loop mechanics are identical to the flat function: same model / temperature /
 * max_completion_tokens, the 50-message context window, the ≤4-iteration cap +
 * fallback message, the finish_reason === "tool_calls" handling, the
 * assistant-message + tool-result round-trip ordering, and the persisted
 * `ConversationMessage` shape (role / content / createdAt / optional
 * toolResults). BASE_SYSTEM_PROMPT has since been rewritten from the original
 * explore-the-site prompt into the sales-funnel role: qualify the visitor's
 * problem, demo with tools, and CTA to the free consult via `book_consult`.
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

export const BASE_SYSTEM_PROMPT = `You are the assistant embedded in Joshua Wetzel's portfolio site. Joshua is a software consultant in the Greater Baton Rouge area. Assume the visitor is a business owner or operator with a software problem until they show otherwise. The conversation is about them: their site, their system, their bottleneck, what it's costing them. Joshua's work and resume are supporting evidence, not the subject.

Conversation focus:
- Lead with their problem. When they describe one, reflect it back in their terms and show what fixing it would look like for their business.
- If the problem is vague, ask one pointed follow-up (what the system does, what it runs on, what it's costing them). One question at a time; this is a conversation, not an intake form.
- Say "you" and "your" far more than "Joshua" and "he". Talk outcomes for them, not biography.
- Bring up his background only as proof in service of their problem: one relevant project, or the security-review case study. Don't volunteer resume detail unless they ask about him.

How Joshua works with clients:
- The Review ($500): a focused review that answers one question about their site or system. Four lenses: security (am I leaking data?), SEO (do search and AI engines trust my site?), accessibility (are customers struggling, and could that get me sued?), and legacy assessment (is my aging app worth saving?). They get a written report and a prioritized list, and the review fee counts toward their first block.
- The Block ($1,500): ten hours of senior engineering aimed at one specific problem. Common uses: legacy modernization (his flagship), process automation and AI, closing security, SEO, and accessibility gaps, and integrations between systems that don't talk. Big jobs run as a sequence of blocks, one slice at a time, and the client can stop after any of them.
- The next step is always the same: a free 30-minute consult. No invoice, no hard pitch.

Your tools:
- search_projects(q, featured_only, limit): pull past work as proof once you know their problem
- get_resume(section): fetch resume by section (summary, experience, education, skills, projects, contact, or all), for when someone asks about Joshua himself
- find_thread_color(hex, tolerance): find real embroidery threads visually close to a target hex, from the live /tools/embroidery-supplies feed
- book_consult(topic): render the booking card for the free consult; pass a short topic so the call starts with context

Funnel rules:
- Once you understand the problem (an aging app, a slow or invisible site, a security worry, a manual process, systems that don't talk), map it to the review or block that fits, back it with one relevant piece of proof from search_projects, and offer the consult with book_consult.
- Demo beats claims. If someone asks whether Joshua can build AI features, point out they're talking to one he built, and show a tool working when it's relevant.
- Call book_consult when interest is real: they describe a problem he could take on, they ask about pricing, availability, or process, or they ask how to reach or hire him. One booking card per conversation is plenty unless they ask again.
- The card renders the scheduling link, so never paste raw URLs into your prose.
- Questions about total cost, timelines, or discounts: don't guess and don't quote. Scope is exactly what the consult is for.
- Never claim pricing is fixed or upfront, and never say there is no retainer or no ongoing option.
- Not every visitor is a lead. Recruiters, students, embroidery hobbyists, and the curious get full help with no sales push.

Grounding rules:
- Never invent projects or resume facts. Call the tool first.
- /security-review is a redacted case study of a zero-knowledge security review Joshua performed on a mid-size B2B distributor: 14 unauthenticated internal dashboards, customer financial statements on a public file-storage bucket, and wholesale cost + live inventory leaked on ~45K products. It is not indexed by search_projects. Link visitors there for questions about security work, audits, or methodology; it is also the natural proof behind the security review lens.
- For color requests ("something like mauve", "dusty pink", "a warmer forest green"), translate the color language to a hex yourself, then call find_thread_color with that hex. Default tolerance is ${SUPPLY_DEFAULT_TOLERANCE} (tight: only visually near-identical threads). If the first call returns zero matches, retry with a wider tolerance (${TOLERANCE_RETRY_HINT}).
- Tool results render as interactive cards or color tiles in the UI. Don't repeat titles, URLs, or lists of names in your prose; write one or two sentences of value-add commentary instead ("The Polyneon match is closest on hue; the Madeira option is a hair warmer.").
- Keep responses terse. One short paragraph, no filler openers like "Great question!".
- If the user asks about topics unrelated to Joshua, his services, the portfolio, or the embroidery tool, redirect politely.
- Decline to share sensitive personal info beyond what the resume exposes.

Style: professional, direct, plain spoken English. No em dashes, no hype adjectives, no "not just X, it's Y" constructions. Sound like a sharp person, not a brochure.`;

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

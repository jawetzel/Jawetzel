/**
 * Portfolio assistant — runs one user turn through OpenAI with the tool
 * registry, loops on tool calls, persists the final assistant message.
 *
 * Storage shape is user/assistant-only (see `conversations.ts`). The live
 * OpenAI message array is rebuilt per turn; tool_call / tool pairs are
 * transient and don't round-trip through Mongo — the `toolResults` array
 * on the stored assistant message carries the UI-renderable payloads.
 */

import OpenAI from "openai";
import type { ObjectId } from "mongodb";

import { getOpenAI } from "./client";
import {
  appendMessage,
  setTitle,
  type ConversationMessage,
  type ToolResultPayload,
} from "./conversations";
import { dispatchTool, toolSchemas } from "./tools/registry";

const MODEL = "gpt-5.4-mini";
const AI_CONTEXT_WINDOW = 50;
const MAX_TOOL_ITERATIONS = 4;
const MAX_TITLE_CHARS = 60;

const BASE_SYSTEM_PROMPT = `You are the assistant embedded in Joshua Wetzel's portfolio site.

Joshua is a full-stack developer based near Baton Rouge, LA. The portfolio showcases his projects, blog posts, resume, and public tools. Your job is to help visitors explore the site and answer questions about Joshua's work.

Your tools:
- search_projects(q, featured_only, limit) — search his portfolio projects
- search_blog(q, tag, limit) — search his blog posts
- get_resume(section) — fetch resume by section (summary, experience, education, skills, projects, contact, or all)
- find_thread_color(hex, tolerance) — find real embroidery threads visually close to a target hex, for the /tools/embroidery-supplies comparison tool

Rules:
- Never invent projects, posts, or resume facts — call the tool first.
- For color requests ("something like mauve", "dusty pink", "a warmer forest green"), translate the color language to a hex yourself, then call find_thread_color with that hex. If the first call returns zero matches, retry once with a wider tolerance (40, then 60).
- Tool results render as interactive cards or color tiles in the UI — don't repeat titles, URLs, or a list of names in your prose. Write 1-2 sentences of value-add commentary instead ("The Polyneon match is closest on hue; the Madeira option is a hair warmer.").
- Keep responses terse. One short paragraph, no filler openers like "Great question!".
- If the user asks about topics unrelated to Joshua, the portfolio, or the embroidery-supplies tool, redirect politely ("I can help with Joshua's work, his writing, or color matching for embroidery threads — anything there I can dig into?").
- Decline to share sensitive personal info beyond what the resume exposes.

Tone: professional, direct, a touch playful. Match Joshua's voice — he ships.`;

function buildOpenAiMessages(
  allMessages: ConversationMessage[],
  pageContext: string | null,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const window = allMessages.slice(-AI_CONTEXT_WINDOW);
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: BASE_SYSTEM_PROMPT },
  ];
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

async function resolvePageContext(pageUrl: string): Promise<string | null> {
  if (!pageUrl) return null;
  let url: URL;
  try {
    url = new URL(pageUrl, "http://localhost");
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return "The user is on the portfolio landing page.";
  if (path === "/about") return "The user is on the About page.";
  if (path === "/contact") return "The user is on the Contact page.";
  if (path === "/privacy") return "The user is on the Privacy page.";
  if (path === "/resume") {
    return "The user is on the Resume page. Use get_resume when they ask for specifics.";
  }
  if (path === "/blog") {
    return "The user is on the blog index. Use search_blog for specific topics.";
  }

  const blogPost = path.match(/^\/blog\/([^/]+)$/);
  if (blogPost) {
    const { getPostBySlug } = await import("@/lib/blog");
    const post = getPostBySlug(blogPost[1]);
    if (post) {
      return (
        `The user is reading this blog post:\n` +
        `Title: ${post.title}\n` +
        `Date: ${post.date}\n` +
        `Tags: ${post.tags.join(", ")}\n` +
        `Description: ${post.description}\n\n` +
        `References to "this post" mean this one.`
      );
    }
  }

  if (path === "/projects") {
    return "The user is browsing the projects list. Use search_projects to surface specifics.";
  }

  const project = path.match(/^\/projects\/([^/]+)$/);
  if (project) {
    const { getProjectBySlug } = await import("@/lib/projects");
    const p = getProjectBySlug(project[1]);
    if (p) {
      return (
        `The user is on this project case study:\n` +
        `Name: ${p.name}\n` +
        `Tagline: ${p.tagline}\n` +
        `Stack: ${p.stack.join(", ")}\n` +
        `Status: ${p.status ?? "unspecified"}\n\n` +
        `References to "this project" mean this one.`
      );
    }
  }

  if (path === "/tools/embroidery-supplies") {
    const qs = url.searchParams;
    const hex = qs.get("hex");
    const brand = qs.get("brand");
    const shop = qs.get("shopping_source");
    const q = qs.get("q");
    const bits: string[] = ["The user is on the embroidery-supplies tool."];
    if (hex) {
      bits.push(
        `Current color filter: #${hex.replace(/^#/, "")}. If they ask for "closer", "warmer", "cooler" variations, call find_thread_color with an adjusted hex.`,
      );
    }
    if (shop) bits.push(`Current shop filter: ${shop}.`);
    if (brand) bits.push(`Current brand filter: ${brand}.`);
    if (q) bits.push(`Current text search: "${q}".`);
    return bits.join(" ");
  }

  return null;
}

export interface RunAssistantTurnInput {
  conversationId: ObjectId;
  /** Full stored history INCLUDING the latest user message. */
  history: ConversationMessage[];
  pageUrl: string;
}

/**
 * Execute one assistant turn: call OpenAI, run any tool calls, loop on
 * tool_call responses, persist the final assistant message, and return
 * it.
 */
export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<ConversationMessage> {
  const client = getOpenAI();
  const pageContext = await resolvePageContext(input.pageUrl);
  const messages = buildOpenAiMessages(input.history, pageContext);

  const toolResults: ToolResultPayload[] = [];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_completion_tokens: 1500,
      messages,
      tools: toolSchemas,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const toolCalls = choice.message.tool_calls ?? [];

    if (choice.finish_reason === "tool_calls" && toolCalls.length > 0) {
      messages.push(
        choice.message as OpenAI.Chat.Completions.ChatCompletionMessageParam,
      );
      for (const tc of toolCalls) {
        if (tc.type !== "function") {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: "Unsupported tool call type" }),
          });
          continue;
        }
        try {
          const result = await dispatchTool(
            tc.function.name,
            tc.function.arguments,
          );
          toolResults.push({ tool: tc.function.name, data: result });
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: err instanceof Error ? err.message : "Tool failed",
            }),
          });
        }
      }
      continue;
    }

    const content = choice.message.content ?? "";
    const assistantMessage: ConversationMessage = {
      role: "assistant",
      content,
      createdAt: new Date(),
      ...(toolResults.length > 0 && { toolResults }),
    };
    await appendMessage(input.conversationId, assistantMessage);
    return assistantMessage;
  }

  const fallback: ConversationMessage = {
    role: "assistant",
    content:
      "I hit my tool-loop limit on this one. Could you rephrase, or narrow the request?",
    createdAt: new Date(),
    ...(toolResults.length > 0 && { toolResults }),
  };
  await appendMessage(input.conversationId, fallback);
  return fallback;
}

/**
 * Generate and persist a short conversation title. Call after the first
 * assistant reply lands, not on every turn. The model gets only the first
 * user/assistant exchange to keep the summary aligned with the opening ask.
 */
export async function summarizeAndSetTitle(input: {
  conversationId: ObjectId;
  userText: string;
  assistantText: string;
}): Promise<string> {
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_completion_tokens: 60,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Return ONLY a JSON object of the form { \"title\": \"...\" }. The title is a short label for a conversation thread — max 60 characters, no trailing period, no quotes around the whole thing, Title Case or sentence case, describe the subject not the question. Example: user asks 'Has Joshua worked with Next.js?' → { \"title\": \"Next.js experience\" }.",
      },
      {
        role: "user",
        content: `User: ${input.userText}\n\nAssistant: ${input.assistantText}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  let title = "New conversation";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.title === "string" && parsed.title.trim()) {
      title = parsed.title.trim().slice(0, MAX_TITLE_CHARS);
    }
  } catch {
    // fall back
  }
  await setTitle(input.conversationId, title);
  return title;
}

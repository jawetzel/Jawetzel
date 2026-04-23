import type {
  ConversationDetail,
  ConversationSummary,
  SendResponse,
} from "./types";

export async function sendMessage(input: {
  message: string;
  pageUrl: string;
  conversationId: string | null;
}): Promise<SendResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `Chat failed (${res.status})`);
  }
  return (await res.json()) as SendResponse;
}

export async function listConversations(page = 1): Promise<{
  items: ConversationSummary[];
  hasMore: boolean;
}> {
  const res = await fetch(`/api/chat/conversations?page=${page}`);
  if (!res.ok) throw new Error("Failed to load conversations");
  const data = await res.json();
  return { items: data.items ?? [], hasMore: Boolean(data.hasMore) };
}

export async function fetchConversation(
  id: string,
): Promise<ConversationDetail> {
  const res = await fetch(`/api/chat/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to load conversation");
  return (await res.json()) as ConversationDetail;
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function claimAnonConversation(
  conversationId: string,
): Promise<{ claimed: boolean }> {
  const res = await fetch("/api/chat/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  });
  if (!res.ok) throw new Error("Failed to claim conversation");
  return (await res.json()) as { claimed: boolean };
}

/**
 * Tool: render the free-consult booking card.
 *
 * The assistant calls this when a visitor shows real interest in working with
 * Joshua. The result renders as a CTA card in the chat UI (Calendly link +
 * email fallback); the model adds at most a line of prose around it. The
 * scheduling URL and email live in SITE so the card can never drift from the
 * rest of the site.
 */

import { SITE } from "@/lib/constants";

const MAX_TOPIC_LENGTH = 120;

export const bookConsultTool = {
  type: "function" as const,
  function: {
    name: "book_consult",
    description:
      "Render a booking card for Joshua's free 30-minute consult. Call it when the visitor describes a problem Joshua could take on, asks about pricing, availability, or process, or asks how to reach or hire him. The card shows the scheduling link and his email, so don't paste either into your prose.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "One short line on what the visitor wants to discuss, e.g. 'modernizing a legacy .NET dispatch system'. Shown on the card so the call starts with context.",
        },
      },
      required: [],
    },
  },
};

export interface BookConsultArgs {
  topic?: string;
}

export interface BookConsultResult {
  url: string;
  duration_minutes: number;
  topic: string | null;
  email: string;
  note: string;
}

export async function executeBookConsult(
  args: BookConsultArgs,
): Promise<BookConsultResult> {
  const topic =
    typeof args?.topic === "string"
      ? args.topic.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH)
      : "";
  return {
    url: SITE.calendly,
    duration_minutes: 30,
    topic: topic || null,
    email: SITE.email,
    note: "Booking card rendered in the UI. Add one short line of prose; don't repeat the link or email.",
  };
}

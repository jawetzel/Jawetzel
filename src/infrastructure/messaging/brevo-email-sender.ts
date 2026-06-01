import {
  type EmailSender,
  type EmailMessage,
} from "@/application/ports/email-sender";

/**
 * BrevoEmailSender — the production {@link EmailSender}, backed by Brevo's
 * transactional SMTP REST API. This is the *only* file that knows Brevo exists;
 * use-cases speak `EmailMessage` and never see `api-key`/`htmlContent`/the
 * endpoint. Swapping providers means writing a sibling adapter and rewiring
 * composition — no use-case changes.
 */
const BREVO_BASE = "https://api.brevo.com/v3";

function getApiKey(): string {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is not set");
  return key;
}

export class BrevoEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const sender = message.sender ?? {
      name: "Joshua Wetzel",
      email: process.env.EMAIL_FROM ?? "mailer@jawetzel.com",
    };

    const res = await fetch(`${BREVO_BASE}/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        htmlContent: message.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brevo send failed (${res.status}): ${body}`);
    }
  }
}

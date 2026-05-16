const BREVO_BASE = "https://api.brevo.com/v3";

function getApiKey(): string {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is not set");
  return key;
}

function getSender(): string {
  const sender = process.env.BREVO_SMS_SENDER;
  if (!sender) throw new Error("BREVO_SMS_SENDER is not set");
  return sender;
}

interface SendSmsOptions {
  /** Recipient in E.164 (e.g. "+12253059321"). Only one recipient. */
  to: string;
  /** Message body. */
  content: string;
  /** Sender name/number. Defaults to BREVO_SMS_SENDER. */
  sender?: string;
  /** "transactional" (default) or "marketing". */
  type?: "transactional" | "marketing";
}

export interface SendSmsResult {
  reference?: string;
  messageId?: number;
}

// Brevo accepts the number with country code, "+" optional. Strip everything
// that isn't a digit or a leading "+" so callers can pass pretty-printed
// numbers without surprises.
function normalizeRecipient(to: string): string {
  const trimmed = to.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/\D/g, "");
}

export async function sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
  const recipient = normalizeRecipient(options.to);
  if (!recipient || recipient.replace(/\D/g, "").length < 8) {
    throw new Error("Invalid recipient phone number");
  }
  if (!options.content.trim()) {
    throw new Error("content is required");
  }

  const res = await fetch(`${BREVO_BASE}/transactionalSMS/sms`, {
    method: "POST",
    headers: {
      "api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: options.sender ?? getSender(),
      recipient,
      content: options.content,
      type: options.type ?? "transactional",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo SMS send failed (${res.status}): ${body}`);
  }

  return (await res.json().catch(() => ({}))) as SendSmsResult;
}

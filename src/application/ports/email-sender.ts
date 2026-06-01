/**
 * EmailSender — a driven port for transactional email.
 *
 * Consumer-owned: this interface lives with the application layer because the
 * use-cases are its consumers, and it is named for the *capability* (send an
 * email), never the technology. The production adapter is
 * `infrastructure/messaging/BrevoEmailSender`; tests use an in-memory fake.
 * Swapping providers is a one-adapter change that never touches a use-case
 * (dependency inversion — see `docs/architecture/overview.md`).
 */
export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailRecipient[];
  subject: string;
  /** Pre-rendered HTML body. */
  html: string;
  /** Optional Reply-To (e.g. route owner replies straight to the sender). */
  replyTo?: EmailRecipient;
  /** Optional sender override; the adapter supplies a default when omitted. */
  sender?: { name: string; email: string };
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

import { type Result, ok, err } from "@/domain/shared/result";
import {
  ContactInquiry,
  type ContactInquiryInput,
  type ContactInquiryError,
} from "@/domain/contact/contact-inquiry";
import { type EmailSender } from "@/application/ports/email-sender";
import { buildOwnerNotification, buildAutoResponse } from "./contact-emails";

/**
 * SubmitContactInquiry — validate an inbound contact message, notify the owner,
 * and (best-effort) send the sender an auto-response.
 *
 * Pure orchestration: it depends only on the {@link EmailSender} port and
 * injected config, so the whole flow runs in a unit test against a fake sender
 * with no network, no Brevo, no env. The owner notification is required (its
 * failure is a returned error); the auto-response is best-effort (its failure is
 * surfaced for logging at the boundary but does not fail the request) — matching
 * the prior route behavior exactly.
 */
export type SubmitContactError =
  | { code: ContactInquiryError }
  | { code: "OWNER_SEND_FAILED"; cause: unknown };

export interface SubmitContactOutcome {
  /** False when the best-effort auto-response failed to send. */
  autoResponseSent: boolean;
  /** Present only when `autoResponseSent` is false — for boundary logging. */
  autoResponseError?: unknown;
}

export interface SubmitContactInquiryDeps {
  email: EmailSender;
  /** Where owner notifications are delivered; injected by composition. */
  ownerEmail: string;
}

export interface SubmitContactInquiry {
  execute(
    input: ContactInquiryInput,
  ): Promise<Result<SubmitContactOutcome, SubmitContactError>>;
}

export function createSubmitContactInquiry(
  deps: SubmitContactInquiryDeps,
): SubmitContactInquiry {
  const { email, ownerEmail } = deps;

  return {
    async execute(input) {
      const inquiry = ContactInquiry.create(input);
      if (!inquiry.ok) return err({ code: inquiry.error });

      try {
        await email.send(buildOwnerNotification(inquiry.value, ownerEmail));
      } catch (cause) {
        return err({ code: "OWNER_SEND_FAILED", cause });
      }

      try {
        await email.send(buildAutoResponse(inquiry.value));
      } catch (autoResponseError) {
        return ok({ autoResponseSent: false, autoResponseError });
      }

      return ok({ autoResponseSent: true });
    },
  };
}

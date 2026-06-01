import { type Result, ok, err } from "@/domain/shared/result";

/**
 * ContactInquiry — a validated inbound contact message (value object).
 *
 * Business invariants enforced *at construction*: required fields present, a
 * well-formed email, a message that isn't trivially empty. Structural concerns
 * (trimming, length clamping, the bot honeypot) are the driving adapter's job
 * and happen before `create` — see `app/api/contact/route.ts`. This is the
 * second tier of the two-tier validation described in
 * `docs/architecture/overview.md`.
 *
 * Invalid states are unconstructable: there is no public constructor, only
 * `create`, which returns a `Result`. Error codes map 1:1 to the HTTP messages
 * the route has always returned, so behavior is preserved.
 */
export type ContactInquiryError =
  | "MISSING_FIELDS"
  | "INVALID_EMAIL"
  | "MESSAGE_TOO_SHORT";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MIN = 2;

export interface ContactInquiryInput {
  name: string;
  email: string;
  message: string;
  projectType?: string;
  timeline?: string;
}

export class ContactInquiry {
  private constructor(
    readonly name: string,
    readonly email: string,
    readonly message: string,
    readonly projectType: string | undefined,
    readonly timeline: string | undefined,
  ) {}

  static create(
    input: ContactInquiryInput,
  ): Result<ContactInquiry, ContactInquiryError> {
    const name = input.name?.trim() ?? "";
    const email = input.email?.trim() ?? "";
    const message = input.message?.trim() ?? "";

    if (!name || !email || !message) return err("MISSING_FIELDS");
    if (!EMAIL_RE.test(email)) return err("INVALID_EMAIL");
    if (message.length < MESSAGE_MIN) return err("MESSAGE_TOO_SHORT");

    const projectType = input.projectType?.trim() || undefined;
    const timeline = input.timeline?.trim() || undefined;

    return ok(new ContactInquiry(name, email, message, projectType, timeline));
  }
}

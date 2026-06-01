import { describe, it, expect } from "vitest";
import {
  type EmailSender,
  type EmailMessage,
} from "@/application/ports/email-sender";
import { createSubmitContactInquiry } from "./submit-contact-inquiry";

/**
 * The payoff of the migration in one file: the entire SubmitContactInquiry flow
 * — validation, owner notification, best-effort auto-response — exercised with
 * no network, no Brevo, no env. The only seam is the EmailSender port, satisfied
 * here by an in-memory fake. This is unreachable in the pre-migration route,
 * where the Brevo HTTP call was imported directly.
 */
class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failOn?: (m: EmailMessage) => boolean;

  async send(message: EmailMessage): Promise<void> {
    if (this.failOn?.(message)) throw new Error("simulated send failure");
    this.sent.push(message);
  }
}

const OWNER = "owner@example.com";
const validInput = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "I have a legacy VB system that needs modernizing.",
  projectType: "Legacy modernization",
  timeline: "Next quarter",
};

function makeUseCase(email: FakeEmailSender) {
  return createSubmitContactInquiry({ email, ownerEmail: OWNER });
}

describe("SubmitContactInquiry", () => {
  it("notifies the owner and sends an auto-response for a valid inquiry", async () => {
    const email = new FakeEmailSender();
    const result = await makeUseCase(email).execute(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.autoResponseSent).toBe(true);

    expect(email.sent).toHaveLength(2);
    const [owner, auto] = email.sent;

    expect(owner.to[0].email).toBe(OWNER);
    expect(owner.replyTo?.email).toBe("ada@example.com");
    expect(owner.subject).toBe("New inquiry from Ada Lovelace");
    expect(owner.html).toContain("Ada Lovelace");
    expect(owner.html).toContain("legacy VB system");
    expect(owner.html).toContain("Legacy modernization");

    expect(auto.to[0].email).toBe("ada@example.com");
    expect(auto.subject).toBe("Got your message — thanks!");
  });

  it("rejects a missing-fields inquiry without sending anything", async () => {
    const email = new FakeEmailSender();
    const result = await makeUseCase(email).execute({
      name: "",
      email: "ada@example.com",
      message: "hello there",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_FIELDS");
    expect(email.sent).toHaveLength(0);
  });

  it("rejects a malformed email", async () => {
    const email = new FakeEmailSender();
    const result = await makeUseCase(email).execute({
      ...validInput,
      email: "not-an-email",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_EMAIL");
    expect(email.sent).toHaveLength(0);
  });

  it("rejects a too-short message", async () => {
    const email = new FakeEmailSender();
    const result = await makeUseCase(email).execute({
      ...validInput,
      message: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MESSAGE_TOO_SHORT");
  });

  it("fails the request when the owner notification can't send", async () => {
    const email = new FakeEmailSender();
    email.failOn = (m) => m.subject.startsWith("New inquiry");
    const result = await makeUseCase(email).execute(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("OWNER_SEND_FAILED");
    // owner send threw before pushing; auto-response never attempted
    expect(email.sent).toHaveLength(0);
  });

  it("still succeeds when only the best-effort auto-response fails", async () => {
    const email = new FakeEmailSender();
    email.failOn = (m) => m.subject.startsWith("Got your message");
    const result = await makeUseCase(email).execute(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.autoResponseSent).toBe(false);
    expect(result.value.autoResponseError).toBeInstanceOf(Error);
    // owner notification still went out
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].subject).toBe("New inquiry from Ada Lovelace");
  });
});

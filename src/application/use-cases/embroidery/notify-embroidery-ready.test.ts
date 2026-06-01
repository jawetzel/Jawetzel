import { describe, it, expect } from "vitest";
import {
  type EmailSender,
  type EmailMessage,
} from "@/application/ports/email-sender";
import { createNotifyEmbroideryReady } from "./notify-embroidery-ready";

class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe("NotifyEmbroideryReady", () => {
  it("emails the user a download link with their first name and hoop size", async () => {
    const email = new FakeEmailSender();
    await createNotifyEmbroideryReady({ email }).execute({
      to: { email: "ada@example.com", name: "Ada Lovelace" },
      zipUrl: "https://files.example.com/out.zip",
      size: "5x7",
    });

    expect(email.sent).toHaveLength(1);
    const msg = email.sent[0];
    expect(msg.to[0].email).toBe("ada@example.com");
    expect(msg.subject).toBe("Your embroidery files (5x7) are ready");
    expect(msg.html).toContain("ready, Ada"); // first name only
    expect(msg.html).toContain("https://files.example.com/out.zip");
    expect(msg.html).toContain("5x7");
  });
});

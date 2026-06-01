import { escapeHtml } from "@/domain/shared/escape-html";
import { type ContactInquiry } from "@/domain/contact/contact-inquiry";
import { type EmailMessage } from "@/application/ports/email-sender";

/**
 * Pure builders that turn a validated {@link ContactInquiry} into vendor-neutral
 * {@link EmailMessage}s. No I/O, no env — every dynamic value is an argument, so
 * these are unit-testable in isolation. The HTML is preserved verbatim from the
 * previous `src/lib/email.ts` so delivered mail is byte-for-byte unchanged.
 */
export function buildOwnerNotification(
  inquiry: ContactInquiry,
  ownerEmail: string,
): EmailMessage {
  const { name, email, message, projectType, timeline } = inquiry;

  const extras = [
    projectType &&
      `<p><strong>Project type:</strong> ${escapeHtml(projectType)}</p>`,
    timeline && `<p><strong>Timeline:</strong> ${escapeHtml(timeline)}</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#174543;color:#ffffff;padding:22px 26px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;font-size:20px;font-weight:600">New inquiry from jawetzel.com</h1>
    </div>
    <div style="background:#ffffff;padding:26px;border:1px solid #e2e6e9;border-top:none;border-radius:0 0 14px 14px">
      <p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
      ${extras}
      <hr style="border:none;border-top:1px solid #e2e6e9;margin:16px 0">
      <p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</p>
    </div>
  </div>
</body>
</html>`.trim();

  return {
    to: [{ email: ownerEmail, name: "Joshua Wetzel" }],
    replyTo: { email, name },
    subject: `New inquiry from ${name}`,
    html,
  };
}

export function buildAutoResponse(inquiry: ContactInquiry): EmailMessage {
  const { name, email } = inquiry;
  const safeName = name.split(/\s+/)[0] || "there";

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#54d9d3;color:#152028;padding:22px 26px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;font-size:20px;font-weight:700">Thanks, ${escapeHtml(safeName)} 👋</h1>
    </div>
    <div style="background:#ffffff;padding:26px;border:1px solid #e2e6e9;border-top:none;border-radius:0 0 14px 14px;line-height:1.6">
      <p>Your message landed. I read every inquiry personally and will get back to you within a couple of business days — usually sooner.</p>
      <p>In the meantime, feel free to poke around my <a href="https://jawetzel.com/projects" style="color:#206f6b">recent work</a> or check out the <a href="https://jawetzel.com/blog" style="color:#206f6b">blog</a>.</p>
      <p>— Joshua</p>
    </div>
  </div>
</body>
</html>`.trim();

  return {
    to: [{ email, name }],
    subject: "Got your message — thanks!",
    html,
  };
}

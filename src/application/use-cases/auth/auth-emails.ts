import { escapeHtml } from "@/domain/shared/escape-html";
import { type EmailMessage } from "@/application/ports/email-sender";

/**
 * Pure builder for the magic-link sign-in email. No I/O and no env — the base
 * URL is passed in (resolved by composition) so this is unit-testable in
 * isolation. HTML preserved verbatim from the previous `src/lib/email.ts`
 * `sendMagicLinkEmail` so delivered mail is unchanged.
 */
export function buildMagicLinkEmail(
  email: string,
  token: string,
  baseUrl: string,
  callbackUrl?: string,
): EmailMessage {
  const base = baseUrl.replace(/\/$/, "");
  const cb = callbackUrl?.startsWith("/")
    ? `&callbackUrl=${encodeURIComponent(callbackUrl)}`
    : "";
  const verifyUrl = `${base}/auth/verify?token=${token}${cb}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#174543;color:#ffffff;padding:22px 26px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;font-size:20px;font-weight:600">Sign in to jawetzel.com</h1>
    </div>
    <div style="background:#ffffff;padding:26px;border:1px solid #e2e6e9;border-top:none;border-radius:0 0 14px 14px;line-height:1.6">
      <p>Click the button below to sign in. The link is good for 30 minutes and only works once.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#174543;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Sign in</a>
      </p>
      <p style="color:#5a6670;font-size:13px;word-break:break-all">Direct link: <a href="${escapeHtml(verifyUrl)}" style="color:#206f6b">${escapeHtml(verifyUrl)}</a></p>
      <p style="color:#5a6670;font-size:13px">If you didn't request this, you can ignore this email — nothing changes until you click the link.</p>
    </div>
  </div>
</body>
</html>`.trim();

  return {
    to: [{ email }],
    subject: "Sign in to jawetzel.com",
    html,
  };
}

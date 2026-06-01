import { escapeHtml } from "@/domain/shared/escape-html";
import { type EmailMessage } from "@/application/ports/email-sender";

/**
 * Pure builder for the "your embroidery files are ready" email. No I/O — every
 * dynamic value is an argument. HTML preserved verbatim from the previous
 * `src/lib/email.ts` `sendEmbroideryGenerationEmail` so delivered mail is
 * unchanged.
 */
export function buildEmbroideryReadyEmail(
  to: { email: string; name: string },
  zipUrl: string,
  size: string,
): EmailMessage {
  const safeName = to.name.split(/\s+/)[0] || "there";
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#54d9d3;color:#152028;padding:22px 26px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;font-size:20px;font-weight:700">Your embroidery files are ready, ${escapeHtml(safeName)}</h1>
    </div>
    <div style="background:#ffffff;padding:26px;border:1px solid #e2e6e9;border-top:none;border-radius:0 0 14px 14px;line-height:1.6">
      <p>Generated at <strong>${escapeHtml(size)}</strong>. The ZIP contains the stitch file plus intermediate artifacts.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(zipUrl)}" style="display:inline-block;background:#174543;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Download ZIP</a>
      </p>
      <p style="color:#5a6670;font-size:13px;word-break:break-all">Direct link: <a href="${escapeHtml(zipUrl)}" style="color:#206f6b">${escapeHtml(zipUrl)}</a></p>
    </div>
  </div>
</body>
</html>`.trim();

  return {
    to: [{ email: to.email, name: to.name }],
    subject: `Your embroidery files (${size}) are ready`,
    html,
  };
}

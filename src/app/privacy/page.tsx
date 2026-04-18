import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Privacy posture for jawetzel.com: no cookies, no trackers, no analytics. Here's what's collected and where it goes.",
};

const last = "April 2026";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
        Privacy
      </p>
      <h1 className="mt-2 font-display text-5xl font-black tracking-tight md:text-6xl">
        Privacy, kept simple.
      </h1>
      <p className="mt-4 text-lg text-[var(--color-text-secondary)]">
        Last updated {last}.
      </p>

      <div className="prose-j mt-10">
        <p>
          This site is static and mostly read-only. It doesn&apos;t set cookies,
          doesn&apos;t track you across pages, and doesn&apos;t run analytics,
          ad networks, or fingerprinting tools. You don&apos;t get a cookie
          banner because there are no cookies to consent to.
        </p>

        <h2>What I collect</h2>
        <p>
          Only what you submit via the <Link href="/contact">contact form</Link>:
          your name, email, and message. That gets delivered to my inbox, I
          read it, and I reply. It lives in my email after that — I don&apos;t
          sync inquiries to a CRM or a list.
        </p>

        <h2>What I don&apos;t collect</h2>
        <ul>
          <li>No cookies set by this site.</li>
          <li>No analytics (no Plausible, Vercel Analytics, GA, nothing).</li>
          <li>No ad networks, no fingerprinting, no third-party trackers.</li>
          <li>No accounts. Nothing to log into.</li>
        </ul>

        <h2>Third parties I do use</h2>
        <ul>
          <li>
            <strong>Brevo</strong> — delivers the email from the contact form.{" "}
            <a
              href="https://www.brevo.com/legal/privacypolicy/"
              target="_blank"
              rel="noreferrer"
            >
              Brevo privacy policy
            </a>
            .
          </li>
          <li>
            <strong>YouTube (no-cookie domain)</strong> — any video embeds use{" "}
            <code>youtube-nocookie.com</code>, which doesn&apos;t set tracking
            cookies until you interact with the player.{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Google privacy policy
            </a>
            .
          </li>
        </ul>

        <h2>Want your info deleted?</h2>
        <p>
          Email me at{" "}
          <a href="mailto:jawetzel615@gmail.com">jawetzel615@gmail.com</a> and
          I&apos;ll remove the thread.
        </p>

        <h2>Changes</h2>
        <p>
          If this posture ever changes — say I add analytics — I&apos;ll update
          this page and commit the change. Git is the history.
        </p>
      </div>
    </div>
  );
}

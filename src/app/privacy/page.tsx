import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/constants";
import { JsonLd, breadcrumbSchema } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Privacy",
  description:
    "Privacy posture for jawetzel.com. Cookieless analytics, no ad networks, and no cookies unless you sign in. This page covers what is collected and where it goes.",
  path: "/privacy",
});

const last = "August 2026";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[breadcrumbSchema([{ name: "Privacy", path: "/privacy" }])]}
      />
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--color-brand-primary-dark)]">
        Privacy
      </p>
      <h1 className="mt-2 font-display text-5xl font-black tracking-tight md:text-6xl">
        Privacy.
      </h1>
      <p className="mt-4 text-lg text-[var(--color-text-secondary)]">
        Last updated {last}.
      </p>

      <div className="prose-j mt-10">
        <p>
          <strong>{SITE.legalName}</strong>, a Louisiana limited liability
          company based in Prairieville, owns and operates jawetzel.com and is
          responsible for anything you send through it. It&apos;s a one-person
          shop, so &ldquo;I&rdquo; below means Joshua Wetzel, and the company
          means the same thing.
        </p>
        <h2>Cookies and analytics</h2>
        <p>
          Google Analytics runs on every page, configured to store nothing:
          consent mode defaults to denied and client storage is turned off, so
          it never writes the <code>_ga</code> cookies and never puts an
          identifier in your browser. It counts page views and referrers and
          nothing else. Because there is no identifier, a return visit looks
          like a brand-new one to me. Google receives your IP address to work
          out an approximate location and discards it; GA4 does not store IPs.
          That is also why there&apos;s no cookie banner: there is nothing
          stored on your device to ask consent for.
        </p>
        <p>
          If you sign in to use the tools, that does set a cookie: a session
          cookie so the site remembers you between pages. It goes away when you
          sign out. The chat widget also keeps its conversation id in your
          browser&apos;s <code>localStorage</code> so a reload doesn&apos;t lose
          the thread. You can clear it any time via your browser&apos;s site
          data.
        </p>

        <h2>What I collect</h2>
        <ul>
          <li>
            <strong>Contact form</strong>: your name, email, and message. That
            gets delivered to my inbox, I read it, and I reply. It lives in my
            email after that. I don&apos;t sync inquiries to a CRM or a list.
          </li>
          <li>
            <strong>Signing in</strong>: your email address, either from a
            magic link or from Google sign-in, stored as an account record.
          </li>
          <li>
            <strong>The embroidery tool</strong>: images you upload and the
            files it generates, kept in object storage and tied to your account
            so you can download them again, plus a count of your generations
            for the monthly quota.
          </li>
          <li>
            <strong>The AI chat</strong>: the transcript, stored on the server.
            Conversations from signed-out visitors are stored too.
          </li>
          <li>
            <strong>Your IP address</strong>, held in memory to rate-limit the
            contact form and the tools. It isn&apos;t written to the database.
          </li>
        </ul>

        <h2>What I don&apos;t do</h2>
        <ul>
          <li>No ad networks, retargeting, or fingerprinting.</li>
          <li>No selling or sharing your data with anyone.</li>
          <li>No marketing email. Signing in doesn&apos;t enroll you in a list.</li>
          <li>No cross-site tracking, and no advertising signals sent to Google.</li>
        </ul>

        <h2>Third parties I do use</h2>
        <ul>
          <li>
            <strong>Google Analytics</strong> measures page views, in the
            cookieless configuration described above.{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Google privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Brevo</strong> delivers the email from the contact form.{" "}
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
            <strong>OpenAI</strong> answers the AI chat. What you type in that
            widget is sent to their API to generate a reply.{" "}
            <a
              href="https://openai.com/policies/privacy-policy/"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Cloudflare R2</strong> stores images you upload to the
            embroidery tool and the files it generates.{" "}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noreferrer"
            >
              Cloudflare privacy policy
            </a>
            .
          </li>
          <li>
            <strong>YouTube (no-cookie domain)</strong>: any video embeds use{" "}
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
          <a href="mailto:josh@jawetzel.com">josh@jawetzel.com</a> and say what
          you want gone: the inquiry thread, your account and its uploads, your
          chat transcripts, or all of it. There&apos;s no form and no ticket
          queue; it&apos;s me doing it by hand.
        </p>

        <h2>Changes</h2>
        <p>
          If this posture changes, I&apos;ll update this page and commit the
          change to the site&apos;s git history, so the diff is public even if
          you never reread the page.
        </p>
      </div>
    </div>
  );
}

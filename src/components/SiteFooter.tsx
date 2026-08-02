import Link from "next/link";
import { CalendarDays, Mail, Phone } from "lucide-react";
import { GithubIcon, LinkedinIcon, YoutubeIcon } from "@/components/BrandIcons";
import { JwMark } from "@/components/JwMark";
import { SITE } from "@/lib/constants";

const year = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
          <div>
            <Link
              href="/"
              aria-label="jawetzel — home"
              className="inline-flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-[var(--color-brand-primary-deep)]"
            >
              <JwMark height={28} />
              <span>jawetzel</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-[var(--color-text-secondary)]">
              Software Consultant. Modernizing legacy systems and shipping
              solo products.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Site
              </h4>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/projects">Work</Link></li>
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/about">About</Link></li>
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/resume">Resume</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                More
              </h4>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/contact">Contact</Link></li>
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/baton-rouge-software-developer">Baton Rouge dev</Link></li>
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/privacy">Privacy</Link></li>
                <li><a className="hover:text-[var(--color-brand-primary-dark)]" href="https://github.com/jawetzel/Jawetzel" target="_blank" rel="noreferrer">Source</a></li>
                <li><Link className="hover:text-[var(--color-brand-primary-dark)]" href="/seo">Login</Link></li>
              </ul>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Elsewhere
            </h4>
            <div className="mt-3 flex items-center gap-3">
              <a
                href="https://github.com/jawetzel"
                aria-label="GitHub"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand-primary)]"
                target="_blank"
                rel="noreferrer"
              >
                <GithubIcon size={18} />
              </a>
              <a
                href="https://www.linkedin.com/in/joshua-wetzel-97a714130"
                aria-label="LinkedIn"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand-primary)]"
                target="_blank"
                rel="noreferrer"
              >
                <LinkedinIcon size={18} />
              </a>
              <a
                href="https://www.youtube.com/@Jawetzel"
                aria-label="YouTube"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand-primary)]"
                target="_blank"
                rel="noreferrer"
              >
                <YoutubeIcon size={18} />
              </a>
              <a
                href="mailto:josh@jawetzel.com"
                aria-label="Email"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand-primary)]"
              >
                <Mail size={18} />
              </a>
              <a
                href="tel:+12253059321"
                aria-label="Phone"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand-primary)]"
              >
                <Phone size={18} />
              </a>
              <a
                href={SITE.calendly}
                aria-label="Book a call"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand-primary)]"
                target="_blank"
                rel="noreferrer"
              >
                <CalendarDays size={18} />
              </a>
            </div>
            <p className="mt-4 text-xs text-[var(--color-text-muted)]">
              Greater Baton Rouge, LA · Remote-proven
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-text-muted)] md:flex-row md:items-center">
          <p>© {year} Joshua Wetzel. No cookies, no trackers.</p>
          <p className="font-mono text-[11px]">v0.1 · shipped with caffeine</p>
        </div>
      </div>
    </footer>
  );
}

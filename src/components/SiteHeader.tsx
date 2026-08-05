"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { JwMark } from "@/components/JwMark";
import { MobileNav } from "@/components/MobileNav";
import { SITE } from "@/lib/constants";

const nav = [
  { href: "/projects", label: "Work" },
  { href: "/tools", label: "Tools" },
  { href: "/about", label: "About" },
  { href: "/resume", label: "Resume" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-[var(--color-surface)] transition-[border-color,box-shadow] duration-300",
        scrolled ? "border-[var(--color-border)] shadow-sm" : "border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:h-20 md:px-6">
        <Link
          href="/"
          aria-label={`${SITE.legalName} home`}
          className="group inline-flex items-center gap-2.5 font-display text-xl font-bold tracking-tight text-[var(--color-brand-primary-deep)]"
        >
          <JwMark height={24} className="hover-wiggle" />
          <span>{SITE.legalName}</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                data-active={active}
                className={cn(
                  "link-sweep px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors",
                  active && "text-[var(--color-text-primary)]"
                )}
              >
                {n.label}
              </Link>
            );
          })}
          <div className="ml-3">
            <Button asChild size="sm" variant="primary">
              <a href={SITE.calendly} target="_blank" rel="noreferrer">
                Let&apos;s talk
              </a>
            </Button>
          </div>
        </nav>

        <MobileNav items={nav} />
      </div>
    </header>
  );
}

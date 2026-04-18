"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/MobileNav";

const nav = [
  { href: "/projects", label: "Work" },
  { href: "/blog", label: "Blog" },
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
          className="group inline-flex items-center gap-2 font-display text-xl font-bold tracking-tight"
        >
          <span className="relative inline-flex h-8 w-8 items-center justify-center hover-wiggle">
            <span className="relative inline-flex h-full w-full overflow-hidden rounded-full bg-[var(--color-brand-primary)]">
              <Image
                src="/avatar.png"
                alt="Joshua Wetzel"
                width={32}
                height={32}
                className="h-full w-full object-cover"
                priority
              />
            </span>
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--color-accent-warm)]" />
          </span>
          <span>jawetzel</span>
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
              <Link href="/contact">Let&apos;s talk</Link>
            </Button>
          </div>
        </nav>

        <MobileNav items={nav} />
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { JwMark } from "@/components/JwMark";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/constants";

type NavItem = { href: string; label: string };

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] touch-manipulation [&_svg]:pointer-events-none"
      >
        <Menu size={20} />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="gap-0">
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <SheetDescription className="sr-only">
          Site sections and contact link
        </SheetDescription>

        <div className="flex items-center gap-2.5 px-6 pt-6 text-[var(--color-brand-primary-deep)]">
          <JwMark height={24} />
          <span className="font-display text-xl font-bold tracking-tight">
            {SITE.legalName}
          </span>
        </div>

        <nav aria-label="Mobile" className="mt-8 flex flex-col px-4 pb-8">
          {items.map((n) => {
            const active =
              pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={close}
                className={cn(
                  "px-3 py-3 text-lg font-medium rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]",
                  active &&
                    "text-[var(--color-text-primary)] bg-[var(--color-surface-muted)]"
                )}
              >
                {n.label}
              </Link>
            );
          })}

          <div className="mt-6 px-3">
            <Button asChild variant="primary" className="w-full">
              <a
                href={SITE.calendly}
                target="_blank"
                rel="noreferrer"
                onClick={close}
              >
                Let&apos;s talk
              </a>
            </Button>
          </div>
        </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

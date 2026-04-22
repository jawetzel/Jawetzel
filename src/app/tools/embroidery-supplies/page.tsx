import type { Metadata } from "next";
import { DollarSign, Package, Scale } from "lucide-react";

import { getCachedSession } from "@/lib/auth";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { SignInButton, SignOutButton } from "@/components/AuthButtons";
import { SupplyFeedSearch } from "./_components/SupplyFeedSearch";
import { FeedDownloadLinks } from "./_components/FeedDownloadLinks";

export const metadata: Metadata = {
  title: "Embroidery supplies",
  description:
    "Compare price-per-unit and quantity across embroidery thread, stabilizer, and blank vendors. Sign in to search the live feed.",
};

export default async function EmbroiderySuppliesPage() {
  const session = await getCachedSession();

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <SectionHeader
        eyebrow="Embroidery supplies"
        title="Price & quantity, side-by-side."
        description="A pricing and quantity comparison feed for embroidery supplies — thread, stabilizer, blanks. Normalizes listings across vendors so you can see what the unit actually costs."
      />

      <div className="mt-12 space-y-10">
        <PublicOverview />

        {session?.user ? (
          <SignedIn
            email={session.user.email ?? ""}
            name={session.user.name ?? ""}
          />
        ) : (
          <SignedOut />
        )}
      </div>
    </div>
  );
}

function PublicOverview() {
  const features = [
    {
      icon: DollarSign,
      title: "Price per unit",
      body: "Vendors love to bundle. This normalizes listings to price-per-spool, price-per-yard, price-per-sheet, etc. — whichever unit actually matters for the category.",
    },
    {
      icon: Package,
      title: "Quantity parity",
      body: "Comparing a 1,000yd spool to a 5,500yd cone is apples-to-oranges without math. The feed does the math.",
    },
    {
      icon: Scale,
      title: "Cross-vendor",
      body: "Listings come from multiple vendors (ingestion TBD). You search once, get the spread.",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {features.map(({ icon: Icon, title, body }) => (
        <div
          key={title}
          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
            <Icon size={18} />
          </span>
          <h3 className="mt-3 font-display text-lg font-semibold text-[var(--color-text-primary)]">
            {title}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {body}
          </p>
        </div>
      ))}
    </div>
  );
}

function SignedOut() {
  return (
    <div className="space-y-6 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Sign-in required</Badge>
        <Badge tone="neutral">Early access</Badge>
      </div>
      <p className="text-[var(--color-text-primary)]">
        The search feed is gated behind a sign-in so I can attribute usage
        while the ingestion pipeline is still coming together. Sign in with
        Google to try it — nothing else is collected.
      </p>
      <SignInButton callbackUrl="/tools/embroidery-supplies" />
    </div>
  );
}

function SignedIn({ email, name }: { email: string; name: string }) {
  return (
    <div className="space-y-6">
      <SupplyFeedSearch />

      <FeedDownloadLinks />

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5 py-4">
        <div className="text-sm">
          <div className="font-medium text-[var(--color-text-primary)]">
            {name || email}
          </div>
          <div className="text-[var(--color-text-secondary)]">{email}</div>
        </div>
        <SignOutButton callbackUrl="/tools/embroidery-supplies" />
      </div>
    </div>
  );
}

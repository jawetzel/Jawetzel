import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-4 py-20 text-center md:px-6">
      <p className="font-display text-[clamp(6rem,20vw,14rem)] font-black leading-none text-[var(--color-brand-primary)]">
        404
      </p>
      <h1 className="mt-4 font-display text-3xl font-bold md:text-4xl">
        This page is off the trellis.
      </h1>
      <p className="mt-4 max-w-lg text-[var(--color-text-secondary)]">
        The thing you were looking for isn&apos;t here. Could&apos;ve been
        renamed, could&apos;ve been an old link, could&apos;ve been a typo.
      </p>
      <div className="mt-8">
        <Button asChild variant="primary">
          <Link href="/">
            <ArrowLeft size={16} /> Back home
          </Link>
        </Button>
      </div>
    </div>
  );
}

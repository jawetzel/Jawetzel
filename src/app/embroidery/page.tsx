import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { getCachedSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { SectionHeader } from "@/components/SectionHeader";
import { SignInPanel } from "@/components/SignInPanel";
import { AccountChip } from "@/components/AccountChip";
import { ImageUploader } from "./_components/ImageUploader";
import { GenerationsList } from "./_components/GenerationsList";
import { ApiKeyPanel } from "./_components/ApiKeyPanel";
import { computeQuota, type Quota } from "./_lib/quota";
import type { DemoImage, Generation } from "@/types/user";
import { pageMetadata } from "@/lib/seo";
import {
  JsonLd,
  breadcrumbSchema,
  webApplicationSchema,
} from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Embroidery",
  description:
    "Generate machine-ready embroidery files from an image. Sign in to try the live testing playground.",
  path: "/embroidery",
});

export default async function EmbroideryPage() {
  const session = await getCachedSession();
  const user = session?.user?.id ? await getUserById(session.user.id) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([{ name: "Embroidery", path: "/embroidery" }]),
          webApplicationSchema({
            path: "/embroidery",
            name: "Embroidery image-to-stitches pipeline",
            description:
              "An AI pipeline that turns a regular image into a production-ready embroidery file, palette-matched against a real thread catalog.",
            applicationCategory: "DesignApplication",
          }),
        ]}
      />
      <SectionHeader
        eyebrow="Embroidery"
        title="Image → machine-ready stitches."
        description="An AI pipeline that turns a regular image into a production embroidery file, palette-matched against a real thread catalog and ready to load into a machine."
      />

      {session?.user && user ? (
        <SignedIn
          email={session.user.email ?? ""}
          name={session.user.name ?? ""}
          demoImages={user.demo_images ?? []}
          generations={user.generations ?? []}
          hasApiKey={Boolean(user.apiKeyHash)}
          quota={computeQuota(user.generations ?? [], undefined, {
            unlimited: user.role === "admin",
          })}
        />
      ) : (
        <SignedOut />
      )}
    </div>
  );
}

function SignedOut() {
  return (
    <div className="mt-16 space-y-10">
      <div className="space-y-6">
        <p className="text-lg text-[var(--color-text-primary)]">
          The testing playground is gated behind a sign-in so I can attribute
          usage and hand out per-account API keys. Nothing beyond the account
          identifier is collected.
        </p>
        <SignInPanel callbackUrl="/embroidery" />
      </div>

      <ApiDocsLink />
    </div>
  );
}

function ApiDocsLink() {
  return (
    <Link
      href="/embroidery/api-docs"
      className="group flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-5 py-4 transition-colors hover:border-[var(--color-brand-primary)]"
    >
      <div className="flex items-start gap-4 min-w-0">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
          <BookOpen size={18} />
        </span>
        <div className="min-w-0">
          <div className="font-medium text-[var(--color-text-primary)]">
            API docs
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Endpoints, authentication, and example requests for calling the
            embroidery pipeline from your own code.
          </p>
        </div>
      </div>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] transition group-hover:rotate-45 group-hover:border-[var(--color-brand-primary)] group-hover:bg-[var(--color-brand-primary)] group-hover:text-[var(--color-brand-primary-deep)]">
        <ArrowUpRight size={18} />
      </span>
    </Link>
  );
}

function SignedIn({
  email,
  name,
  demoImages,
  generations,
  hasApiKey,
  quota,
}: {
  email: string;
  name: string;
  demoImages: DemoImage[];
  generations: Generation[];
  hasApiKey: boolean;
  quota: Quota;
}) {
  return (
    <div className="mt-16 space-y-10">
      <ImageUploader
        initialImages={demoImages}
        initialGenerations={generations}
        quota={quota}
      />

      <GenerationsList generations={generations} />

      <ApiKeyPanel hasKey={hasApiKey} />

      <ApiDocsLink />

      <AccountChip email={email} name={name} callbackUrl="/embroidery" />
    </div>
  );
}

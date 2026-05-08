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
  faqSchema,
} from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Embroidery",
  description:
    "Free embroidery digitization. Upload an image, download machine-ready stitches. No account setup, no credit card.",
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
            name: "Free embroidery digitization",
            description:
              "Upload an image, download machine-ready embroidery files. Free, no credit card, instant results.",
            applicationCategory: "DesignApplication",
          }),
          faqSchema({
            questions: [
              {
                question: "Is it really free?",
                answer:
                  "Yes. Upload, download, use commercially — no credit card, no limits, no signups beyond an email.",
              },
              {
                question: "What formats do you accept?",
                answer: "JPG, PNG, GIF — anything you'd throw at a typical image tool.",
              },
              {
                question: "What do I get back?",
                answer:
                  "Machine-ready embroidery files: .pes, .jef, .exp, .vip, and others. Load straight into any embroidery machine.",
              },
              {
                question: "Can I use this commercially?",
                answer:
                  "Yes. No restrictions. Digitize for clients, integrate via API, sell finished embroidery — all free.",
              },
              {
                question: "What images work?",
                answer:
                  "Logos, line art, hand drawings, clean photos. Avoid tiny details and photorealism with 1000+ colors — embroidery has physical limits.",
              },
              {
                question: "Is there an API?",
                answer:
                  "Yes. Per-account API keys for production workflows. See the API docs for endpoints and examples.",
              },
            ],
          }),
        ]}
      />
      <SectionHeader
        eyebrow="Embroidery"
        title="Image → embroidery files."
        description="Upload an image. Get back machine-ready stitches. Free, no account setup, no credit card."
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
          Upload an image — get back embroidery files (`.pes`, `.jef`, etc.) ready to stitch. Free, instant, no setup.
        </p>

        <p className="text-[var(--color-text-secondary)]">
          Sign in to access the playground. No credit card needed — nothing beyond your email is collected.
        </p>

        <SignInPanel callbackUrl="/embroidery" />
      </div>

      <ApiDocsLink />
    </div>
  );
}


function ApiDocsLink() {
  return (
    <div className="space-y-4">
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

      <Link
        href="/tools/embroidery-supplies"
        className="group flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-5 py-4 transition-colors hover:border-[var(--color-brand-primary)]"
      >
        <div className="flex items-start gap-4 min-w-0">
          <div className="min-w-0">
            <div className="font-medium text-[var(--color-text-primary)]">
              Embroidery supplies
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Price comparison across thread, stabilizer, and blank vendors.
            </p>
          </div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] transition group-hover:rotate-45 group-hover:border-[var(--color-brand-primary)] group-hover:bg-[var(--color-brand-primary)] group-hover:text-[var(--color-brand-primary-deep)]">
          <ArrowUpRight size={18} />
        </span>
      </Link>
    </div>
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

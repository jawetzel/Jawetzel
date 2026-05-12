import Link from "next/link";
import { ArrowUpRight, BookOpen, ChevronDown, Download, KeyRound } from "lucide-react";
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

        <BeforeAfterExample />

        <div className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">
              Why sign in?
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Only to keep bots out of the free pipeline. Your email is never
              used for marketing — no newsletter, no drip, no follow-up. There's
              no signup form past this and no credit card on file.
            </p>
          </div>

          <SignInPanel callbackUrl="/embroidery" />
        </div>
      </div>

      <ApiDocsLink />
    </div>
  );
}

const BEFORE_IMAGE_URL =
  "https://images.jawetzel.com/embroidery/69e6c60baefd74cfc45fbe0b/uploads/74f4bb414791c27b2076c208.jpg";
const AFTER_PREVIEW_URL = "https://images.jawetzel.com/embroidery/embroidery.bmp";
const AFTER_ZIP_URL =
  "https://images.jawetzel.com/embroidery/69e6c60baefd74cfc45fbe0b/292adb3e6635_4x4/out.zip";

function BeforeAfterExample() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ExampleCard
          label="Before — your upload"
          caption="JPG, PNG, anything"
          imageSrc={BEFORE_IMAGE_URL}
          imageAlt="Example logo uploaded to the embroidery pipeline"
        />
        <ExampleCard
          label="After — stitch-ready files"
          caption=".pes · .jef · .dst · .exp · .vp3 · .xxx"
          imageSrc={AFTER_PREVIEW_URL}
          imageAlt="Rendered stitch preview of the digitized embroidery design"
          footer={
            <a
              href={AFTER_ZIP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-brand-primary-deep)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-brand-primary-dark)]"
            >
              <Download size={14} />
              Download example zip
            </a>
          }
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Real output from the pipeline — same files you'll get back, loadable
        straight into a Brother, Janome, Husqvarna, or Singer machine.
      </p>
    </div>
  );
}

function ExampleCard({
  label,
  caption,
  imageSrc,
  imageAlt,
  footer,
}: {
  label: string;
  caption: string;
  imageSrc: string;
  imageAlt: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
      <div className="flex aspect-square items-center justify-center bg-[var(--color-surface)] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={imageAlt}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="space-y-3 p-4">
        <div>
          <div className="font-medium text-[var(--color-text-primary)]">
            {label}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {caption}
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}


function ApiDocsLinkCard() {
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

function EmbroiderySuppliesLinkCard() {
  return (
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
  );
}

function ApiDocsLink() {
  // Signed-out users see both cards inline — they can't issue a key, but the
  // API docs are public and embroidery supplies is unrelated to API access.
  return (
    <div className="space-y-4">
      <ApiDocsLinkCard />
      <EmbroiderySuppliesLinkCard />
    </div>
  );
}

// Collapses the API-only surface (key panel + API docs link) behind a single
// row labelled "Need API access?". Most signed-in users are here to upload an
// image, not call the API — keeping it tucked away cuts visual noise.
function ApiAccessDisclosure({ hasApiKey }: { hasApiKey: boolean }) {
  return (
    <details className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] open:bg-[var(--color-surface-raised)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-[var(--color-brand-primary)] [&::-webkit-details-marker]:hidden">
        <div className="flex items-start gap-4 min-w-0">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
            <KeyRound size={18} />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-[var(--color-text-primary)]">
              Need API access?
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Issue a key and read the endpoint docs.
            </p>
          </div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] transition group-open:rotate-180">
          <ChevronDown size={18} />
        </span>
      </summary>
      <div className="space-y-4 border-t border-[var(--color-border)] p-5">
        <ApiKeyPanel hasKey={hasApiKey} />
        <ApiDocsLinkCard />
      </div>
    </details>
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
      >
        {/* GenerationsList renders inside the uploader so it can be hidden in
            focus mode (when a single upload is selected for generation). */}
        <GenerationsList generations={generations} />
      </ImageUploader>

      <ApiAccessDisclosure hasApiKey={hasApiKey} />

      <EmbroiderySuppliesLinkCard />

      <AccountChip email={email} name={name} callbackUrl="/embroidery" />
    </div>
  );
}

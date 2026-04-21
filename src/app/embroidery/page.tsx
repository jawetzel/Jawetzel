import type { Metadata } from "next";
import { getCachedSession } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { SectionHeader } from "@/components/SectionHeader";
import { SignInButton, SignOutButton } from "./_components/AuthButtons";
import { ImageUploader } from "./_components/ImageUploader";
import { GenerationsList } from "./_components/GenerationsList";
import { computeQuota, type Quota } from "./_lib/quota";
import type { DemoImage, Generation } from "@/types/user";

export const metadata: Metadata = {
  title: "Embroidery",
  description:
    "Generate machine-ready embroidery files from an image. Sign in to try the live testing playground.",
};

export default async function EmbroideryPage() {
  const session = await getCachedSession();
  const user = session?.user?.id ? await getUserById(session.user.id) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <SectionHeader
        eyebrow="Embroidery"
        title="Image → machine-ready stitches."
        description="An AI pipeline that turns a regular image into a production embroidery file — palette-matched, inked, and ready for your machine."
      />

      {session?.user && user ? (
        <SignedIn
          email={session.user.email ?? ""}
          name={session.user.name ?? ""}
          demoImages={user.demo_images ?? []}
          generations={user.generations ?? []}
          quota={computeQuota(user.generations ?? [])}
        />
      ) : (
        <SignedOut />
      )}
    </div>
  );
}

function SignedOut() {
  return (
    <div className="mt-16 space-y-6">
      <p className="text-lg text-[var(--color-text-primary)]">
        The testing playground is gated behind a sign-in so I can attribute
        usage and hand out per-account API keys. Sign in with Google to try it
        — nothing else is collected.
      </p>
      <SignInButton />
    </div>
  );
}

function SignedIn({
  email,
  name,
  demoImages,
  generations,
  quota,
}: {
  email: string;
  name: string;
  demoImages: DemoImage[];
  generations: Generation[];
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

      <div className="rounded-2xl border border-[var(--color-border)] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">
              API access
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Generate a personal API key to call the embroidery endpoints
              directly. Not available yet.
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
            Coming soon
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5 py-4">
        <div className="text-sm">
          <div className="font-medium text-[var(--color-text-primary)]">
            {name || email}
          </div>
          <div className="text-[var(--color-text-secondary)]">{email}</div>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}

import { Palette, Image as ImageIcon, ShieldOff } from "lucide-react";

import { SectionHeader } from "@/components/SectionHeader";
import { pageMetadata } from "@/lib/seo";
import {
  JsonLd,
  breadcrumbSchema,
  webApplicationSchema,
} from "@/lib/jsonld";

import { ImageToSvgDrop } from "./_components/ImageToSvgDrop";

export const metadata = pageMetadata({
  title: "Image to SVG",
  description:
    "Drop in a PNG, JPG, or WebP and get a colored SVG vector back. Background removed automatically. No signup, no options to fiddle with.",
  path: "/tools/image-to-svg",
});

export default function ImageToSvgPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([
            { name: "Tools", path: "/tools" },
            { name: "Image to SVG", path: "/tools/image-to-svg" },
          ]),
          webApplicationSchema({
            path: "/tools/image-to-svg",
            name: "Image to SVG",
            description:
              "Convert a raster image (PNG, JPG, WebP, GIF, BMP) into a colored SVG. Background detection + per-color potrace, no thread palette.",
            applicationCategory: "MultimediaApplication",
          }),
        ]}
      />
      <SectionHeader
        eyebrow="Image to SVG"
        title="Drop an image. Get a vector."
        description="Raster in, colored SVG out. Background is detected and stripped, then each foreground color becomes its own vector layer. Colors stay as they are in the source, no palette snapping."
      />

      <div className="mt-10">
        <ImageToSvgDrop />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <Feature
          icon={ImageIcon}
          title="Any common raster"
          body="PNG, JPG, WebP, GIF, BMP. Up to 15 MB. Transparency is honored if present."
        />
        <Feature
          icon={Palette}
          title="Colors preserved"
          body="No bucketing to a thread palette. Up to 128 distinct color regions, each emitted as its own SVG layer."
        />
        <Feature
          icon={ShieldOff}
          title="No signup"
          body="Nothing stored, nothing tracked per user. The file lives in memory long enough to trace, then it's gone."
        />
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Palette;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--color-brand-primary-100)] text-[var(--color-brand-primary-deep)]">
        <Icon size={18} />
      </span>
      <h3 className="mt-3 font-display text-lg font-semibold text-[var(--color-text-primary)]">
        {title}
      </h3>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{body}</p>
    </div>
  );
}

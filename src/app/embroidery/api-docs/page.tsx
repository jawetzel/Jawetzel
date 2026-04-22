import type { Metadata } from "next";
import { ScalarReference } from "./_components/ScalarReference";

export const metadata: Metadata = {
  title: "Embroidery API docs",
  description:
    "OpenAPI reference for the embroidery pipeline — generate, palettes, sizes. Authenticate with your personal API key.",
};

export default function EmbroideryApiDocsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-surface)]">
      <ScalarReference specUrl="/openapi/embroidery" />
    </div>
  );
}

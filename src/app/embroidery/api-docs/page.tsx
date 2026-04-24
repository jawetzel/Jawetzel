import { ScalarReference } from "./_components/ScalarReference";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, breadcrumbSchema, techArticleSchema } from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Embroidery API docs",
  description:
    "OpenAPI reference for the embroidery pipeline — generate, palettes, sizes. Authenticate with your personal API key.",
  path: "/embroidery/api-docs",
});

export default function EmbroideryApiDocsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-surface)]">
      <JsonLd
        graph={[
          breadcrumbSchema([
            { name: "Embroidery", path: "/embroidery" },
            { name: "API docs", path: "/embroidery/api-docs" },
          ]),
          techArticleSchema({
            path: "/embroidery/api-docs",
            headline: "Embroidery pipeline API reference",
            description:
              "OpenAPI reference for the embroidery pipeline — generate, palettes, sizes. Authenticate with your personal API key.",
          }),
        ]}
      />
      <ScalarReference specUrl="/openapi/embroidery" />
    </div>
  );
}

import { ProjectCard } from "@/components/ProjectCard";
import { SecurityAuditCard } from "@/components/SecurityAuditCard";
import { SectionHeader } from "@/components/SectionHeader";
import { getAllProjects } from "@/lib/projects";
import { pageMetadata } from "@/lib/seo";
import {
  JsonLd,
  breadcrumbSchema,
  collectionPageSchema,
} from "@/lib/jsonld";

export const metadata = pageMetadata({
  title: "Work",
  description:
    "Case studies of solo-shipped products and a redacted security audit, each written around the problem it solved.",
  path: "/projects",
});

export default function ProjectsPage() {
  const projects = getAllProjects();

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <JsonLd
        graph={[
          breadcrumbSchema([{ name: "Work", path: "/projects" }]),
          collectionPageSchema({
            name: "Work · Joshua Wetzel",
            description:
              "Case studies of solo-shipped products and a redacted security audit.",
            path: "/projects",
            items: [
              ...projects.map((p) => ({
                name: p.name,
                path: `/projects/${p.slug}`,
                description: p.tagline,
              })),
              {
                name: "Security audit (redacted)",
                path: "/security-audit",
                description:
                  "Zero-knowledge audit of a B2B distributor that surfaced a severe data exposure.",
              },
            ],
          }),
        ]}
      />
      <SectionHeader
        eyebrow="The work"
        title="Solo-built products and a field report."
        description="Each one I built end-to-end, and each one has real users on it. Click through for the problem-to-outcome story on each."
      />

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {projects[0] && <ProjectCard key={projects[0].slug} project={projects[0]} index={0} />}
        <SecurityAuditCard index={1} />
        {projects.slice(1).map((p, i) => (
          <ProjectCard key={p.slug} project={p} index={i + 2} />
        ))}
      </div>
    </div>
  );
}

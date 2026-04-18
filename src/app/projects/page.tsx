import type { Metadata } from "next";
import { ProjectCard } from "@/components/ProjectCard";
import { SectionHeader } from "@/components/SectionHeader";
import { getAllProjects } from "@/lib/projects";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Selected case studies — four solo-shipped products leading with the problem each one solved.",
};

export default function ProjectsPage() {
  const projects = getAllProjects();

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <SectionHeader
        eyebrow="The work"
        title="Products, not portfolio filler."
        description="Four things I built end-to-end — each one real, live, and load-bearing. Click through for the problem-to-outcome story on each."
      />

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {projects.map((p, i) => (
          <ProjectCard key={p.slug} project={p} index={i} />
        ))}
      </div>
    </div>
  );
}

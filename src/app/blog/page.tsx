import type { Metadata } from "next";
import Link from "next/link";
import { Play, FileText, Video, Layers } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { getAllPosts, getAllTags, type BlogPost } from "@/lib/blog";
import { readingTimeMinutes } from "@/lib/markdown";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Articles, videos, and field notes on legacy modernization, solo SaaS engineering, and AI-assisted ops tooling.",
};

type SearchParams = { kind?: string; tag?: string };

function kindIcon(kind: BlogPost["kind"]) {
  if (kind === "video") return <Video size={12} />;
  if (kind === "both") return <Layers size={12} />;
  return <FileText size={12} />;
}

export default async function BlogIndex({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const activeKind = (params.kind ?? "all") as "all" | "article" | "video" | "both";
  const activeTag = params.tag;

  let posts = getAllPosts();
  if (activeKind !== "all") {
    posts = posts.filter(
      (p) => p.kind === activeKind || (activeKind !== "article" && p.kind === "both")
    );
  }
  if (activeTag) posts = posts.filter((p) => p.tags.includes(activeTag));

  const tags = getAllTags();
  const filters: { label: string; value: string; icon: React.ReactNode }[] = [
    { label: "All", value: "all", icon: <Layers size={14} /> },
    { label: "Articles", value: "article", icon: <FileText size={14} /> },
    { label: "Videos", value: "video", icon: <Video size={14} /> },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-16 md:px-6 md:pt-24">
      <SectionHeader
        eyebrow="The lab notebook"
        title="Writing, videos, and field notes."
        description="Short, practical posts about the work. New things go up when they're ready — no schedule to keep."
      />

      {/* Filter strip */}
      <div className="mt-10 flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const isActive = activeKind === f.value;
          const href = f.value === "all" ? "/blog" : `/blog?kind=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-[var(--color-brand-primary-deep)] text-[var(--color-text-inverse)]"
                  : "border border-[var(--color-border)] bg-[var(--color-surface-elevated)] hover:border-[var(--color-brand-primary)]"
              }`}
            >
              {f.icon} {f.label}
            </Link>
          );
        })}
        {tags.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-2">
            {activeTag && (
              <Link
                href="/blog"
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-brand-primary)]"
              >
                × clear
              </Link>
            )}
            {tags.slice(0, 8).map((t) => {
              const isActive = activeTag === t.tag;
              return (
                <Link
                  key={t.tag}
                  href={`/blog?tag=${encodeURIComponent(t.tag)}`}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition ${
                    isActive
                      ? "bg-[var(--color-brand-primary)] text-[var(--color-brand-primary-deep)]"
                      : "border border-[var(--color-border)] hover:border-[var(--color-brand-primary)]"
                  }`}
                >
                  #{t.tag}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Posts */}
      <div className="mt-12 space-y-6">
        {posts.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
            No posts match that filter yet.
          </p>
        )}
        {posts.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="group grid gap-6 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 transition hover:-translate-y-1 hover:border-[var(--color-brand-primary)] hover:shadow-[0_24px_48px_-16px_rgba(23,69,67,0.15)] md:grid-cols-[220px_1fr] md:p-7"
          >
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-[var(--color-brand-primary-50)] md:aspect-[4/3]">
              {p.youtubeId ? (
                <img
                  alt=""
                  src={`https://i.ytimg.com/vi/${p.youtubeId}/hqdefault.jpg`}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              ) : p.hero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={p.hero}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="font-display text-5xl font-black text-[var(--color-brand-primary-dark)] opacity-30">
                    {p.date.slice(5)}
                  </div>
                </div>
              )}
              {(p.kind === "video" || p.kind === "both") && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-primary-deep)]/90 text-[var(--color-text-inverse)] shadow-lg transition group-hover:scale-110">
                    <Play size={18} fill="currentColor" />
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
                {kindIcon(p.kind)}
                <span>{p.kind}</span>
                <span>·</span>
                <time dateTime={p.date}>{p.date}</time>
                <span>·</span>
                <span>{readingTimeMinutes(p.bodyMd)} min read</span>
              </div>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight group-hover:text-[var(--color-brand-primary-dark)] md:text-3xl">
                {p.title}
              </h2>
              <p className="mt-3 text-[var(--color-text-secondary)]">
                {p.description}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {p.tags.map((t) => (
                  <Badge key={t} tone="brand">
                    #{t}
                  </Badge>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

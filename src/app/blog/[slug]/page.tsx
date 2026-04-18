import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { renderMarkdown, readingTimeMinutes } from "@/lib/markdown";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Not found" };
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return notFound();

  const html = await renderMarkdown(post.bodyMd);
  const all = getAllPosts();
  const idx = all.findIndex((p) => p.slug === slug);
  const prev = idx < all.length - 1 ? all[idx + 1] : null; // chronologically older
  const next = idx > 0 ? all[idx - 1] : null;

  return (
    <article className="mx-auto max-w-3xl px-4 pb-24 pt-12 md:px-6 md:pt-16">
      <Link
        href="/blog"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        <ArrowLeft size={16} /> All posts
      </Link>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
          <CalendarDays size={14} />
          <time dateTime={post.date}>{post.date}</time>
          <span>·</span>
          <span>{readingTimeMinutes(post.bodyMd)} min read</span>
          <span>·</span>
          <span>{post.kind}</span>
        </div>
        <h1 className="mt-4 font-display text-4xl font-black leading-tight tracking-tight md:text-6xl">
          {post.title}
        </h1>
        <p className="mt-4 text-xl text-[var(--color-text-secondary)]">
          {post.description}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {post.tags.map((t) => (
            <Badge key={t} tone="brand">
              #{t}
            </Badge>
          ))}
        </div>
      </header>

      {post.youtubeId && (
        <div className="mt-10 aspect-video overflow-hidden rounded-2xl border border-[var(--color-border)] bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${post.youtubeId}`}
            title={post.title}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}

      <div
        className="prose-j mt-10"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <nav className="mt-20 grid gap-4 border-t border-[var(--color-border)] pt-10 md:grid-cols-2">
        {prev ? (
          <Link
            href={`/blog/${prev.slug}`}
            className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 transition hover:border-[var(--color-brand-primary)]"
          >
            <p className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
              <ArrowLeft size={14} /> Older
            </p>
            <p className="mt-2 font-display text-lg font-semibold">
              {prev.title}
            </p>
          </Link>
        ) : <div />}
        {next ? (
          <Link
            href={`/blog/${next.slug}`}
            className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 text-right transition hover:border-[var(--color-brand-primary)]"
          >
            <p className="inline-flex items-center justify-end gap-2 text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
              Newer <ArrowRight size={14} />
            </p>
            <p className="mt-2 font-display text-lg font-semibold">
              {next.title}
            </p>
          </Link>
        ) : <div />}
      </nav>
    </article>
  );
}

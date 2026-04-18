import { cn } from "@/lib/utils";

export function SectionHeader({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow && (
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-brand-primary-dark)]">
          <span className="mr-2 inline-block h-2 w-2 translate-y-[-2px] rounded-full bg-[var(--color-brand-primary)]" />
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-3xl font-bold tracking-tight md:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-lg text-[var(--color-text-secondary)]">
          {description}
        </p>
      )}
    </div>
  );
}

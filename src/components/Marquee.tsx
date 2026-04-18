import { cn } from "@/lib/utils";

export function Marquee({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  const doubled = [...items, ...items];
  const duration = items.length * 7;
  return (
    <div
      className={cn(
        "relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
        className
      )}
    >
      <div
        className="flex min-w-max"
        style={{ animation: `marquee ${duration}s linear infinite` }}
      >
        {doubled.map((s, i) => (
          <span
            key={i}
            className="mx-6 inline-flex items-center gap-4 font-display text-2xl font-medium text-[var(--color-text-secondary)] md:text-3xl"
          >
            {s}
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-brand-primary)]" />
          </span>
        ))}
      </div>
    </div>
  );
}

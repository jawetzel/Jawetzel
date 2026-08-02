const RATIO = 89.5 / 43;

/**
 * The JW monogram. Stems and serifs take `currentColor`; the accent dot is the
 * one fixed colour so the mark reads the same wherever it inherits from.
 * Source of truth for the paths is `public/logo/jw-mark.svg`.
 */
export function JwMark({
  height = 28,
  className,
  dotColor = "var(--color-accent-warm)",
}: {
  height?: number;
  className?: string;
  dotColor?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="4.5 8.5 89.5 43"
      height={height}
      width={Math.round(height * RATIO)}
      fill="none"
      role="img"
      aria-label="JW"
      className={className}
    >
      <g
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M28 12v22c0 8.5-6 13.5-13.5 12C11 45.4 9 43.4 8 41" />
        <path d="M40 12l9.5 36 10.5-25 10.5 25L80 12" />
        <path d="M19 12h9M40 12h9M71 12h9" />
      </g>
      <circle cx="90" cy="24" r="4" fill={dotColor} />
    </svg>
  );
}

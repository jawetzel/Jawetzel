// Removes the Nth <path/> element (by document order) for every N in `drop`.
// Index order here matches PathRecord.index from analyzeSvg, since both walk
// the SVG text in the same left-to-right order.
export function stripPaths(
  svgBytes: Uint8Array,
  drop: Iterable<number>,
): Uint8Array {
  const dropSet = drop instanceof Set ? drop : new Set(drop);
  if (dropSet.size === 0) return svgBytes;
  const svg = new TextDecoder().decode(svgBytes);
  let counter = 0;
  // Consume trailing whitespace with the match so dropped paths don't leave blank-line cruft.
  const out = svg.replace(/<path\b[^>]*?\/>\s*/g, (match) => {
    const idx = counter++;
    return dropSet.has(idx) ? "" : match;
  });
  return new TextEncoder().encode(out);
}

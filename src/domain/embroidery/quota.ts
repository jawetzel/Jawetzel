import type { Generation } from "@/types/user";

/**
 * Embroidery generation quota — a pure domain rule with **zero I/O**. The policy
 * is **20 generations per rolling 30-day window**; the caller passes in the
 * user's already-read `Generation[]` and `computeQuota` decides how many of them
 * fall inside the window, whether the cap is exceeded, and (when it is) when the
 * oldest in-window generation ages out to free the next slot.
 *
 * Moved verbatim from `src/app/embroidery/_lib/quota.ts`. The window comparison
 * is **strict less-than** (a generation exactly `WINDOW_MS` old is *not*
 * in-window), the threshold is `>= MONTHLY_LIMIT`, and the `unlimited` option
 * short-circuits `exceeded` (and therefore `nextResetAt`). The `now` parameter
 * defaults to the current epoch ms so callers can omit it; tests pass it
 * explicitly for determinism.
 */
export const MONTHLY_LIMIT = 20;
export const WINDOW_DAYS = 30;
export const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface Quota {
  used: number;
  limit: number;
  exceeded: boolean;
  unlimited: boolean;
  // When the oldest in-window generation ages out, freeing the next slot.
  // null when the user is under the limit.
  nextResetAt: Date | null;
}

export function computeQuota(
  generations: Generation[],
  now: number = Date.now(),
  options: { unlimited?: boolean } = {},
): Quota {
  const unlimited = !!options.unlimited;
  const inWindow = generations.filter(
    (g) => now - new Date(g.createdAt).getTime() < WINDOW_MS,
  );
  const used = inWindow.length;
  const exceeded = !unlimited && used >= MONTHLY_LIMIT;
  let nextResetAt: Date | null = null;
  if (exceeded) {
    const sorted = [...inWindow].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    nextResetAt = new Date(
      new Date(sorted[0].createdAt).getTime() + WINDOW_MS,
    );
  }
  return { used, limit: MONTHLY_LIMIT, exceeded, unlimited, nextResetAt };
}

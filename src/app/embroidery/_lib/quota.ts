import type { Generation } from "@/types/user";

export const MONTHLY_LIMIT = 3;
export const WINDOW_DAYS = 30;
export const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface Quota {
  used: number;
  limit: number;
  exceeded: boolean;
  // When the oldest in-window generation ages out, freeing the next slot.
  // null when the user is under the limit.
  nextResetAt: Date | null;
}

export function computeQuota(
  generations: Generation[],
  now: number = Date.now(),
): Quota {
  const inWindow = generations.filter(
    (g) => now - new Date(g.createdAt).getTime() < WINDOW_MS,
  );
  const used = inWindow.length;
  const exceeded = used >= MONTHLY_LIMIT;
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
  return { used, limit: MONTHLY_LIMIT, exceeded, nextResetAt };
}

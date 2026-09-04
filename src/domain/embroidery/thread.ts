/**
 * Embroidery thread value shapes.
 *
 * A `Thread` is one entry in a manufacturer's `.gpl` catalog — the atom the
 * whole pipeline trades in (palette load → AI selection → post-trace snap →
 * Ink/Stitch attrs). It lived in `app/embroidery/_lib/inkstitch/gpl-palette.ts`
 * next to the `readFileSync` catalog loader, which forced the application layer
 * to import *outward* into `app/` just to name its own contract. The type is
 * pure data with zero I/O, so it belongs here; `gpl-palette.ts` re-exports it so
 * every existing `_lib` import stays unchanged.
 */

/** One catalog thread: display hex, manufacturer name, manufacturer number. */
export type Thread = { hex: string; name: string; number: string };

/**
 * A `Thread` the AI palette step picked, plus the semantic `role` it assigned
 * ("background" threads are stripped from the trace entirely — no stitches).
 */
export type SelectedThread = Thread & { role?: string };

/**
 * Result<T, E> — the explicit return type for *expected* failures.
 *
 * Use a Result when a caller is expected to branch on failure (validation,
 * "not found", a downstream send that may fail). Use `throw` only for
 * exceptional faults the caller can't sensibly handle. See
 * `docs/architecture/overview.md` → "Errors".
 *
 * This is a pure value with zero I/O — it lives in `domain/` so every layer
 * may depend on it.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

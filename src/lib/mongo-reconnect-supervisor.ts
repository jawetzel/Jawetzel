/**
 * Reconnect policy for the singleton MongoClient, kept out of the connection module so the
 * retry/backoff behaviour is unit-testable with fakes and no database, and the wiring there stays
 * a few lines of adapter glue.
 *
 * Why it exists at all: see the note on `getMongoClient`. The driver does not recover from a
 * *failed initial connect*, so something has to call connect() a second time.
 *
 * The supervisor never logs and never touches a timer directly; both are injected.
 */

export type ReconnectEvent =
  | { kind: "scheduled"; attempt: number; delayMs: number }
  | { kind: "recovered"; attempt: number }
  | { kind: "failed"; attempt: number; error: unknown };

export interface ReconnectSupervisorDeps {
  /** Reconnect the client. Production passes `client.connect()`. */
  connect: () => Promise<unknown>;
  /**
   * Timer injection. Production passes an unref'd setTimeout so a retry loop can never
   * hold a one-off script -- or a shutting-down server -- open on its own.
   */
  schedule: (run: () => void, delayMs: number) => void;
  /** Structured notifications for the caller to log. */
  report?: (event: ReconnectEvent) => void;
  /** First retry delay; doubles on each consecutive failure. */
  baseDelayMs?: number;
  /** Ceiling for the doubling, so a long outage settles into steady polling. */
  maxDelayMs?: number;
}

export interface ReconnectSupervisor {
  /**
   * The topology closed. Starts a retry chain; a no-op while one is already scheduled or
   * in flight, so the `topologyClosed` the driver emits from inside a *failing* reconnect
   * attempt cannot fork a second chain.
   */
  notifyClosed(): void;
  /** Deliberate shutdown -- stop retrying, permanently. */
  stop(): void;
  /** True while a retry is scheduled or running. */
  isPending(): boolean;
}

export function createReconnectSupervisor(deps: ReconnectSupervisorDeps): ReconnectSupervisor {
  const baseDelayMs = deps.baseDelayMs ?? 250;
  const maxDelayMs = deps.maxDelayMs ?? 30_000;

  let stopped = false;
  let pending = false;
  let attempt = 0;

  function scheduleNext(): void {
    if (stopped || pending) return;
    pending = true;
    attempt += 1;
    const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    deps.report?.({ kind: "scheduled", attempt, delayMs });
    deps.schedule(() => void run(), delayMs);
  }

  async function run(): Promise<void> {
    if (stopped) {
      pending = false;
      return;
    }
    const thisAttempt = attempt;
    try {
      await deps.connect();
    } catch (error) {
      deps.report?.({ kind: "failed", attempt: thisAttempt, error });
      // Cleared BEFORE scheduling, or scheduleNext would see its own chain as pending.
      pending = false;
      scheduleNext();
      return;
    }
    // Reset the backoff so an unrelated incident later starts from baseDelayMs again.
    attempt = 0;
    pending = false;
    deps.report?.({ kind: "recovered", attempt: thisAttempt });
  }

  return {
    notifyClosed: scheduleNext,
    stop() {
      stopped = true;
    },
    isPending: () => pending,
  };
}

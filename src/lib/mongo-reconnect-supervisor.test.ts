import { describe, it, expect, vi } from "vitest";
import { createReconnectSupervisor, type ReconnectEvent } from "./mongo-reconnect-supervisor";

/**
 * The supervisor exists because a single transient TLS alert otherwise leaves the client
 * permanently dead with MongoTopologyClosedError. Timer and connect are both injected, so this
 * runs with no database and no real waiting.
 */

/** A fake clock: `schedule` queues, `runNext()` fires the queued callback. */
function createTimerFake() {
  const queue: Array<{ run: () => void; delayMs: number }> = [];
  const history: number[] = [];
  return {
    schedule: (run: () => void, delayMs: number) => {
      history.push(delayMs);
      queue.push({ run, delayMs });
    },
    /** Every delay ever scheduled, including already-fired ones. */
    delays: () => history,
    pendingCount: () => queue.length,
    /** Fire the next queued callback and let the async work it kicks off settle. */
    async runNext() {
      const next = queue.shift();
      if (!next) throw new Error("no timer scheduled");
      next.run();
      // The callback starts an unawaited attempt; yield past the macrotask boundary so
      // its connect() and the follow-up scheduling have both run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("createReconnectSupervisor", () => {
  it("reconnects after the topology closes", async () => {
    const timers = createTimerFake();
    const connect = vi.fn().mockResolvedValue(undefined);
    const supervisor = createReconnectSupervisor({ connect, schedule: timers.schedule });

    supervisor.notifyClosed();
    expect(connect).not.toHaveBeenCalled(); // waits out the backoff first
    expect(supervisor.isPending()).toBe(true);

    await timers.runNext();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(supervisor.isPending()).toBe(false);
  });

  it("retries with doubling backoff, capped", async () => {
    const timers = createTimerFake();
    const connect = vi.fn().mockRejectedValue(new Error("tlsv1 alert internal error"));
    const supervisor = createReconnectSupervisor({
      connect,
      schedule: timers.schedule,
      baseDelayMs: 100,
      maxDelayMs: 400,
    });

    supervisor.notifyClosed();
    for (let i = 0; i < 4; i++) await timers.runNext();

    expect(connect).toHaveBeenCalledTimes(4);
    // 100 → 200 → 400 → capped at 400, plus the still-queued 5th attempt.
    expect(timers.delays()).toEqual([100, 200, 400, 400, 400]);
  });

  it("resets the backoff once a reconnect succeeds", async () => {
    const timers = createTimerFake();
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    const supervisor = createReconnectSupervisor({
      connect,
      schedule: timers.schedule,
      baseDelayMs: 100,
    });

    supervisor.notifyClosed();
    await timers.runNext(); // fails  → schedules 200ms
    await timers.runNext(); // succeeds

    // A later, unrelated incident starts from the base delay again, not from 400ms.
    supervisor.notifyClosed();
    expect(timers.delays()).toEqual([100, 200, 100]);
  });

  it("does not fork a second retry chain when a failing attempt re-emits topologyClosed", async () => {
    const timers = createTimerFake();
    // The driver closes the topology it just built when a connect attempt fails, which
    // re-emits `topologyClosed` from inside our own connect() call.
    const supervisor = createReconnectSupervisor({
      connect: vi.fn().mockImplementation(async () => {
        supervisor.notifyClosed();
        throw new Error("connect failed");
      }),
      schedule: timers.schedule,
      baseDelayMs: 100,
    });

    supervisor.notifyClosed();
    await timers.runNext();

    // Exactly one retry queued — the re-entrant notify was absorbed, not chained.
    expect(timers.pendingCount()).toBe(1);
    expect(timers.delays()).toEqual([100, 200]);
  });

  it("ignores repeat notifications while an attempt is already pending", () => {
    const timers = createTimerFake();
    const supervisor = createReconnectSupervisor({
      connect: vi.fn().mockResolvedValue(undefined),
      schedule: timers.schedule,
    });

    supervisor.notifyClosed();
    supervisor.notifyClosed();
    supervisor.notifyClosed();

    expect(timers.pendingCount()).toBe(1);
  });

  it("stops reconnecting after stop(), including a timer already scheduled", async () => {
    const timers = createTimerFake();
    const connect = vi.fn().mockResolvedValue(undefined);
    const supervisor = createReconnectSupervisor({ connect, schedule: timers.schedule });

    supervisor.notifyClosed();
    supervisor.stop(); // deliberate shutdown between the schedule and the firing
    await timers.runNext();

    expect(connect).not.toHaveBeenCalled();

    supervisor.notifyClosed();
    expect(timers.pendingCount()).toBe(0);
  });

  it("reports each transition for the caller to log", async () => {
    const timers = createTimerFake();
    const events: ReconnectEvent[] = [];
    const supervisor = createReconnectSupervisor({
      connect: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined),
      schedule: timers.schedule,
      report: (e) => events.push(e),
      baseDelayMs: 100,
    });

    supervisor.notifyClosed();
    await timers.runNext();
    await timers.runNext();

    expect(events.map((e) => e.kind)).toEqual(["scheduled", "failed", "scheduled", "recovered"]);
  });
});

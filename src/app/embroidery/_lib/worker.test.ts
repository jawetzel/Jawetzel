import { describe, it, expect } from "vitest";
import * as shim from "./worker";
import * as port from "@/application/ports/embroidery-compute-gateway";

/**
 * Covers the one thing this shim exists to guarantee: that it **re-exports**
 * `WorkerError` rather than redefining it. All three generate routes catch the
 * Python worker's failures with `err instanceof WorkerError` imported from
 * *here*, while the error is thrown by the adapter from the *port* — a second
 * class declaration would silently break every one of those checks (and the
 * `status === 503` retry path with them) with no type error to catch it.
 *
 * This assertion previously sat in
 * `infrastructure/embroidery/http-embroidery-worker.test.ts`, which forced an
 * infrastructure test to import `app/` (`infrastructure-inward-only`). It is a
 * property of the shim, so it belongs beside the shim; the adapter's own
 * querystring tests stay where they are.
 */

describe("worker shim", () => {
  it("re-exports the port's WorkerError class object, not a redefinition", () => {
    expect(shim.WorkerError).toBe(port.WorkerError);
  });

  it("preserves instanceof identity across the shim (the routes' catch check)", () => {
    expect(new port.WorkerError(503, "/x", "y")).toBeInstanceOf(shim.WorkerError);
    expect(new shim.WorkerError(503, "/x", "y")).toBeInstanceOf(port.WorkerError);
  });
});

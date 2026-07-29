/**
 * App-layer clock (spec §2 rule 2 + §14 debug menu).
 *
 * ONE OffsetClock instance is created at boot (src/app/main.ts) and
 * injected into every app-layer consumer of time: the ticker's TICK
 * `at` timestamps, care-action dispatch timestamps (via ui/), the
 * persistence layer's `savedAt`, and the recovery/export filenames.
 *
 * `now()` is the wrapped clock plus a skewable offset. The debug menu's
 * +1h/+6h/+24h buttons call `skew()`, so QA fast-forward moves every
 * consumer at once — expedition/egg timers (Phase 4) derive from these
 * same timestamps and need no special handling.
 *
 * Core purity is untouched: core/ still only ever receives numbers on
 * action payloads. In tests, compose OffsetClock over a FakeClock.
 */

import type { Clock } from "../core/clock";
import { SystemClock } from "../core/clock";

export class OffsetClock implements Clock {
  private offset: number;

  constructor(
    private readonly inner: Clock = new SystemClock(),
    initialOffsetMs = 0,
  ) {
    this.offset = initialOffsetMs;
  }

  /** Wrapped time plus the accumulated skew. */
  now(): number {
    return this.inner.now() + this.offset;
  }

  /** Shift the clock by `ms` (adds to any existing offset; negative
   * un-skews). Affects every consumer of this instance immediately. */
  skew(ms: number): void {
    this.offset += ms;
  }

  /** Current total offset — the debug menu's readout. */
  offsetMs(): number {
    return this.offset;
  }
}

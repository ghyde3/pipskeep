/**
 * Time is injected (spec §2 rule 2).
 *
 * This file is the ONLY place in the entire repo allowed to call
 * `Date.now()` (or `new Date()`). Everything else receives a `Clock`.
 */

/** Milliseconds since the Unix epoch (or an arbitrary test origin). */
export interface Clock {
  now(): number;
}

/** Production clock. Sole permitted call site of `Date.now()` in the repo. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * Deterministic clock for tests. Starts at `start` (default 0) and only
 * moves when told to.
 */
export class FakeClock implements Clock {
  private t: number;

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  /** Advance the clock by exactly `ms` milliseconds. */
  advance(ms: number): void {
    this.t += ms;
  }

  /** Jump the clock to an absolute time `t`. */
  set(t: number): void {
    this.t = t;
  }
}

/**
 * Time is injected (spec §2 rule 2).
 *
 * This file is the ONLY place in the entire repo allowed to call
 * `Date.now()` (or `new Date()`). Everything else receives a `Clock` —
 * and formats timestamps via `isoStamp` below, so the repo-wide
 * "no `new Date(` outside clock.ts" grep stays at exactly zero.
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
 * Format a Clock timestamp (ms) as an ISO-8601 UTC string. A pure,
 * deterministic function of its argument — it reads no ambient time —
 * but it lives here because rendering a timestamp requires `Date`.
 */
export function isoStamp(ms: number): string {
  return new Date(ms).toISOString();
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

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

/** A calendar month/day pair (month 1–12), the smallest date shape events
 * (docs/retention-bible.md §8.3) need — never a full `Date`. */
export interface MonthDay {
  readonly month: number;
  readonly day: number;
}

/**
 * The UTC calendar month/day a timestamp falls on (round 2C — events,
 * bible §8.3: "the app layer resolves which events are active... core
 * reads only the id list"). This is the ONE place allowed to ask that
 * question; `core/progression/events.ts` takes the resulting `MonthDay` as
 * plain data and stays Date-free itself.
 */
export function monthDayFromMs(ms: number): MonthDay {
  const d = new Date(ms);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The day-boundary offset the streak/bounty day index reads (round 2C,
 * bible §3.1): `dayIndex(at) = floor((at - dayOffsetMs) / dayMs)` should
 * increment once per LOCAL calendar day, at `dayStartHour` local time
 * (04:00 by default) — not at UTC midnight. Derived once here (the only
 * file allowed to ask "what timezone is this", spec §2 rule 2) and
 * dispatched into `GameState` via `SET_DAY_OFFSET`; the app layer is
 * expected to recompute and redispatch at boot and on `visibilitychange`
 * so a DST shift or a flight across timezones is honestly reflected. A
 * boundary shift from doing so can only ever GIFT a streak day (the
 * `delta <= 0` no-op in `core/progression/streak.ts`) or be absorbed by
 * grace — never take one, by the same reasoning the bible gives for why
 * clock-tampering is harmless (spec §4.5's "we do not care" ruling).
 *
 * Derivation: `local = utc - getTimezoneOffset() * 60_000` (the JS
 * convention: `getTimezoneOffset()` is the minutes to ADD to local time to
 * reach UTC), and we want
 * `floor((at - dayOffsetMs) / dayMs) === floor((local - dayStartHour·1h) / dayMs)`,
 * which solves to `dayOffsetMs = dayStartHour·1h + getTimezoneOffset()·60_000`.
 */
export function localDayOffsetMs(
  dayStartHour: number,
  referenceMs: number = Date.now(),
): number {
  const HOUR_MS = 60 * 60 * 1000;
  const tzOffsetMs = new Date(referenceMs).getTimezoneOffset() * 60_000;
  return dayStartHour * HOUR_MS + tzOffsetMs;
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

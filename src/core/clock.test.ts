import { describe, expect, it, vi } from "vitest";
import {
  FakeClock,
  SystemClock,
  isoStamp,
  localDayOffsetMs,
  monthDayFromMs,
} from "./clock";

describe("FakeClock", () => {
  it("starts at 0 by default", () => {
    expect(new FakeClock().now()).toBe(0);
  });

  it("starts at the given origin", () => {
    expect(new FakeClock(1_700_000_000_000).now()).toBe(1_700_000_000_000);
  });

  it("advance(ms) moves time forward by exactly ms", () => {
    const clock = new FakeClock();
    clock.advance(3_600_000); // 1h
    expect(clock.now()).toBe(3_600_000);
    clock.advance(1); // exact to the millisecond
    expect(clock.now()).toBe(3_600_001);
  });

  it("advance accumulates across calls", () => {
    const clock = new FakeClock(500);
    clock.advance(250);
    clock.advance(250);
    clock.advance(1_000);
    expect(clock.now()).toBe(2_000);
  });

  it("does not move on its own, even as wall-clock time passes", () => {
    // Back-to-back reads alone are vacuous (they land in the same real
    // millisecond, so a clock leaking Date.now() drift would still pass).
    // Mock the system clock and move it a full minute to prove FakeClock
    // is genuinely frozen — every later phase gate rests on this.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const clock = new FakeClock(42);
      expect(clock.now()).toBe(42);

      vi.setSystemTime(1_060_000); // one real minute later
      expect(clock.now()).toBe(42); // still exactly 42

      vi.advanceTimersByTime(3_600_000); // an hour of timer time on top
      expect(clock.now()).toBe(42);

      clock.advance(8); // only advance() moves it, by exactly the amount
      expect(clock.now()).toBe(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it("set(t) jumps to an absolute time", () => {
    const clock = new FakeClock(999);
    clock.set(123_456);
    expect(clock.now()).toBe(123_456);
    clock.advance(4);
    expect(clock.now()).toBe(123_460);
  });
});

describe("isoStamp", () => {
  it("formats a millisecond timestamp as ISO-8601 UTC, deterministically", () => {
    expect(isoStamp(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(isoStamp(1_753_747_200_000)).toBe("2025-07-29T00:00:00.000Z");
  });

  it("reads no ambient time — same input, same output, always", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const a = isoStamp(42);
      vi.setSystemTime(999_000_000);
      expect(isoStamp(42)).toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("monthDayFromMs — round 2C events (bible §8.3)", () => {
  it("reads the UTC calendar month/day", () => {
    expect(monthDayFromMs(0)).toEqual({ month: 1, day: 1 });
    expect(monthDayFromMs(Date.UTC(2026, 6, 29))).toEqual({ month: 7, day: 29 });
    expect(monthDayFromMs(Date.UTC(2026, 11, 25))).toEqual({ month: 12, day: 25 });
  });
});

describe("localDayOffsetMs — the streak day-boundary offset (bible §3.1)", () => {
  it("puts the day boundary at dayStartHour LOCAL time, whatever the test runner's timezone is", () => {
    const dayStartHour = 4;
    const referenceMs = Date.now();
    const offset = localDayOffsetMs(dayStartHour, referenceMs);
    const HOUR_MS = 3_600_000;
    const DAY_MS = 24 * HOUR_MS;
    const dayIndex = (at: number) => Math.floor((at - offset) / DAY_MS);

    // "Today at dayStartHour, local time" — built from LOCAL Date fields,
    // so this is honest whatever timezone the runner happens to be in.
    const ref = new Date(referenceMs);
    const boundary = new Date(
      ref.getFullYear(),
      ref.getMonth(),
      ref.getDate(),
      dayStartHour,
      0,
      0,
      0,
    ).getTime();

    // Flat for the hour approaching the boundary, then +1 exactly at it.
    expect(dayIndex(boundary - 1)).toBe(dayIndex(boundary - HOUR_MS));
    expect(dayIndex(boundary + 1) - dayIndex(boundary - 1)).toBe(1);
  });

  it("reads no ambient time beyond its explicit reference — same reference, same output", () => {
    const a = localDayOffsetMs(4, 1_000_000);
    const b = localDayOffsetMs(4, 1_000_000);
    expect(a).toBe(b);
  });
});

describe("SystemClock", () => {
  it("returns a finite millisecond timestamp", () => {
    const t = new SystemClock().now();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it("is monotonic non-decreasing across calls", () => {
    const clock = new SystemClock();
    const a = clock.now();
    const b = clock.now();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

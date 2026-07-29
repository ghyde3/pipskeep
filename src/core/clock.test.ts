import { describe, expect, it, vi } from "vitest";
import { FakeClock, SystemClock, isoStamp } from "./clock";

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

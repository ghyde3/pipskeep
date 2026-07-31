/**
 * ⚠️ ROUND 2K FIX STAGE — MUTATION 11b'S GUARD.
 *
 * The mutation: in `main.ts`'s `sampleSky`, change `clock.now()` to
 * `Date.now()`. Result: 139 files and 3 566 tests green, and the debug
 * time slider silently stops moving the sky — the QA tool `daylight.ts`'s
 * own module doc calls "the QA tool for the whole feature".
 *
 * `daylight.test.ts` guards the MODULE against exactly this (and correctly
 * fails eleven tests when `daylightAt` itself reaches for `Date.now()`),
 * but `main.ts` is imported by no test, so the wiring that makes the
 * guarantee true was unverified. The expression now lives in
 * `skySampler.ts` so it can be driven directly, and this file drives it:
 * through a real `OffsetClock` over a `FakeClock`, checking that a skew
 * changes what the SCENE is handed — not merely what `daylightAt` returns.
 */

import { describe, expect, it } from "vitest";
import { createSkySampler } from "./skySampler";
import type { SkyTarget } from "./skySampler";
import { OffsetClock } from "./appClock";
import { daylightAt } from "./daylight";
import { weatherAt } from "./weather";
import type { DaylightSample } from "./daylight";
import type { WeatherSample } from "./weather";
import type { Clock } from "../core/clock";

const HOUR = 60 * 60 * 1000;

class FixedClock implements Clock {
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
}

function recorder(): SkyTarget & {
  readonly daylight: DaylightSample[];
  readonly weather: WeatherSample[];
} {
  const daylight: DaylightSample[] = [];
  const weather: WeatherSample[] = [];
  return {
    daylight,
    weather,
    setDaylight: (s) => void daylight.push(s),
    setWeather: (s) => void weather.push(s),
  };
}

/** A moment we can reason about: 2026-06-15T12:00 LOCAL, midday. */
const NOON_LOCAL = (() => {
  const d = new Date(2026, 5, 15, 12, 0, 0, 0);
  return d.getTime();
})();

describe("the sky sampler reads the INJECTED clock", () => {
  it("hands the scene the daylight for the clock's time, not the wall clock's", () => {
    const target = recorder();
    const clock = new FixedClock(NOON_LOCAL);
    createSkySampler(clock, target, () => 7)();
    expect(target.daylight[0]).toEqual(daylightAt(NOON_LOCAL));
    expect(target.daylight[0]?.phase).toBe("day");
  });

  /**
   * ⚠️ THE MUTATION GUARD ITSELF. With `Date.now()` in the sampler both
   * samples below are identical, because the OffsetClock's skew is
   * invisible to it. This is the assertion that was missing.
   */
  it("SKEWING an OffsetClock moves the sky — the debug slider's whole contract", () => {
    const target = recorder();
    const clock = new OffsetClock(new FixedClock(NOON_LOCAL), 0);
    const sample = createSkySampler(clock, target, () => 7);

    sample();
    clock.skew(12 * HOUR); // midday → midnight
    sample();

    const [day, night] = target.daylight;
    expect(day?.phase).toBe("day");
    expect(night?.phase).toBe("night");
    expect(night?.skyTop).not.toBe(day?.skyTop);
  });

  it("every hour of a full day round-trips the clock, so no phase is unreachable", () => {
    const target = recorder();
    const clock = new OffsetClock(new FixedClock(NOON_LOCAL), 0);
    const sample = createSkySampler(clock, target, () => 7);
    for (let h = 0; h < 24; h += 1) {
      sample();
      clock.skew(HOUR);
    }
    const phases = new Set(target.daylight.map((d) => d.phase));
    // A sampler pinned to a wall clock would report ONE phase 24 times.
    expect(phases.size).toBeGreaterThanOrEqual(3);
    expect(phases).toContain("night");
    expect(phases).toContain("day");
  });

  it("the WEATHER call gets the same clock — the mutation applies to both lines", () => {
    const target = recorder();
    const clock = new OffsetClock(new FixedClock(NOON_LOCAL), 0);
    const sample = createSkySampler(clock, target, () => 7);
    sample();
    // Far enough that the weather window must have rolled over.
    clock.skew(30 * 24 * HOUR);
    sample();
    expect(target.weather[0]).toEqual(weatherAt(7, NOON_LOCAL));
    expect(target.weather[1]?.window).not.toBe(target.weather[0]?.window);
  });

  it("reads the CURRENT seed each call — the store replaces state on every dispatch", () => {
    const target = recorder();
    let seed = 1;
    const sample = createSkySampler(new FixedClock(NOON_LOCAL), target, () => seed);
    sample();
    seed = 999;
    sample();
    expect(target.weather[0]).toEqual(weatherAt(1, NOON_LOCAL));
    expect(target.weather[1]).toEqual(weatherAt(999, NOON_LOCAL));
  });
});

describe("main.ts is actually wired to this sampler", () => {
  // Source-level, for the same reason `pushWiring.test.ts` is: a
  // composition root has no runtime seam a unit test can reach, and this
  // is precisely where the feature died silently once already.
  const mainSource = (
    import.meta.glob("./main.ts", { query: "?raw", import: "default", eager: true }) as Record<
      string,
      string
    >
  )["./main.ts"];

  it("calls createSkySampler and does not re-inline the expression", () => {
    expect(mainSource).toBeTypeOf("string");
    expect(mainSource).toContain("createSkySampler(clock, scene");
  });

  it("never reaches for Date.now() or new Date() anywhere in the app's boot", () => {
    // The app layer owns Date (spec §2 rule 2), but the ONE shared
    // OffsetClock is how it owns it — a raw `Date.now()` here is the
    // mutation, written by hand.
    const withoutComments = (mainSource ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/\bDate\.now\(\)/);
    expect(withoutComments).not.toMatch(/\bnew Date\(/);
  });
});

/**
 * TIME OF DAY (round 2K, docs/liveliness-bible.md §4.2, test plan §7.5.5).
 *
 * The three things this suite exists to stop:
 *   1. The ramp silently losing a phase (or a phase's colours drifting
 *      off the authored anchors).
 *   2. `day` ceasing to be byte-identical to the shipped palette — the
 *      one guarantee that means this round cannot have made the Keep
 *      look worse at the hour most players open it.
 *   3. ⚠️ A MUTATION THAT REACHES FOR `Date.now()`. The whole feature's
 *      QA tool is "drag the debug time slider and watch the sky move",
 *      and that only works because the sample is a pure function of the
 *      injected `OffsetClock`'s number. The last two tests drive the ramp
 *      through a `FakeClock` composed under an `OffsetClock` and assert
 *      the skew moves the phase — which a `Date.now()` implementation
 *      cannot pass.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { keepPalette } from "../content/palette";
import { tuning } from "../content/tuning";
import { OffsetClock } from "./appClock";
import {
  DAY_MS,
  daylightAt,
  daylightChangedEnough,
  localHourOf,
  mixHex,
  phaseAt,
} from "./daylight";
import type { DaylightPhase } from "./daylight";

/** A local-midnight epoch, so `localHourOf` lands on whole hours whatever
 * timezone the test host is in. */
function localMidnight(): number {
  const d = new Date(2026, 6, 31, 0, 0, 0, 0);
  return d.getTime();
}

/** Epoch ms for a local hour on that day. */
function atHour(hour: number): number {
  return localMidnight() + hour * 3_600_000;
}

const HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => i);

describe("phaseAt", () => {
  it("covers all 24 hours with exactly the four authored phases", () => {
    const seen = new Set<DaylightPhase>();
    for (const h of HOURS) {
      const { phase, blend } = phaseAt(h);
      seen.add(phase);
      expect(blend).toBeGreaterThanOrEqual(0);
      expect(blend).toBeLessThanOrEqual(1);
    }
    expect([...seen].sort()).toEqual(["dawn", "day", "dusk", "night"]);
  });

  it("puts each phase at the hours the tuning table declares", () => {
    const s = tuning.liveliness.daylight.phaseStartHour;
    expect(phaseAt(s.dawn).phase).toBe("dawn");
    expect(phaseAt(s.day).phase).toBe("day");
    expect(phaseAt(s.dusk).phase).toBe("dusk");
    expect(phaseAt(s.night).phase).toBe("night");
    // The boundary belongs to the phase it STARTS, never the one it ends.
    expect(phaseAt(s.day - 0.001).phase).toBe("dawn");
    expect(phaseAt(s.dusk - 0.001).phase).toBe("day");
  });

  it("wraps night through midnight rather than restarting it", () => {
    expect(phaseAt(23).phase).toBe("night");
    expect(phaseAt(0).phase).toBe("night");
    expect(phaseAt(3).phase).toBe("night");
    // Blend must increase monotonically ACROSS midnight (23:00 → 01:00).
    expect(phaseAt(1).blend).toBeGreaterThan(phaseAt(23).blend);
  });

  it("normalises hours outside 0..24 instead of throwing", () => {
    expect(phaseAt(25).phase).toBe(phaseAt(1).phase);
    expect(phaseAt(-1).phase).toBe(phaseAt(23).phase);
  });
});

describe("daylightAt", () => {
  it("DAY IS BYTE-IDENTICAL TO THE SHIPPED PALETTE (the no-regression guarantee)", () => {
    // Mid-day, well clear of the cross-fade into dusk.
    const s = daylightAt(atHour(12));
    expect(s.phase).toBe("day");
    expect(s.skyTop).toBe(keepPalette.skyTop);
    expect(s.skyBottom).toBe(keepPalette.skyBottom);
    expect(s.sunColor).toBe(keepPalette.sunGlow);
    // The overlay is the thing that could dim the shipped look. At day it
    // must be exactly, literally zero — not 0.001, not "close enough".
    expect(s.overlayAlpha).toBe(0);
    expect(s.isMoon).toBe(false);
    expect(s.lanternGlow).toBe(0);
  });

  it("never exceeds the tuned night alpha — the legibility cap (bible §4.2)", () => {
    const cap = Math.max(...Object.values(tuning.liveliness.daylight.overlayAlpha));
    for (let ms = 0; ms < DAY_MS; ms += 60_000) {
      expect(daylightAt(localMidnight() + ms).overlayAlpha).toBeLessThanOrEqual(cap + 1e-9);
    }
    expect(cap).toBeLessThanOrEqual(0.22);
  });

  it("is continuous — no visible jump between consecutive samples", () => {
    // A cut would show as a big colour delta between two samples one
    // minute apart. The cross-fade exists precisely to prevent that.
    let worst = 0;
    let prev = daylightAt(localMidnight());
    for (let ms = 60_000; ms < DAY_MS; ms += 60_000) {
      const s = daylightAt(localMidnight() + ms);
      worst = Math.max(worst, channelDistance(prev.skyTop, s.skyTop));
      prev = s;
    }
    // ~4% of the channel range per wall minute is a smooth ramp; a hard
    // four-step cut would be 20%+ at the flips.
    expect(worst).toBeLessThan(0.05);
  });

  it("turns the sky to night, and the moon comes out", () => {
    const night = daylightAt(atHour(23));
    const day = daylightAt(atHour(12));
    expect(night.phase).toBe("night");
    expect(night.isMoon).toBe(true);
    expect(night.overlayAlpha).toBeGreaterThan(0.15);
    // Night's sky is genuinely darker, not merely different.
    expect(luminance(night.skyTop)).toBeLessThan(luminance(day.skyTop) * 0.6);
  });

  it("lights the lanterns at dusk and puts them out by day (the best beat in §4.2)", () => {
    expect(daylightAt(atHour(12)).lanternGlow).toBe(0);
    expect(daylightAt(atHour(18)).lanternGlow).toBeGreaterThan(0.5);
    expect(daylightAt(atHour(23)).lanternGlow).toBe(1);
  });

  it("⚠️ MID-AFTERNOON IS PLAIN DAY — the cross-fade is an hour, not a third of a phase", () => {
    // THE REGRESSION THIS PINS, found in the browser: the fade ran over
    // "the last third of each phase", and the day phase is NINE HOURS
    // long, so the sky started turning sunset-pink at 14:00 and was 57%
    // dusk by 15:42. The module's own doc always said "at 16:00 it is
    // plain day, by 17:00 it is fully dusk" — the code just did not do it.
    for (const h of [9, 12, 14, 15, 15.7, 16]) {
      const s = daylightAt(atHour(h));
      expect(s.phase, `hour ${h}`).toBe("day");
      expect(s.skyTop, `hour ${h} sky`).toBe(keepPalette.skyTop);
      expect(s.overlayAlpha, `hour ${h} overlay`).toBe(0);
    }
    // …and it IS fading by half past four, fully dusk by five.
    expect(daylightAt(atHour(16.5)).skyTop).not.toBe(keepPalette.skyTop);
    expect(daylightAt(atHour(17)).phase).toBe("dusk");
  });

  it("keeps the small hours of the night fully night, not half-dawn", () => {
    // The same arithmetic bit the 9-hour night phase: a third of it put
    // the sky into dawn colours from 02:00.
    for (const h of [21, 23, 1, 3]) {
      expect(daylightAt(atHour(h)).phase, `hour ${h}`).toBe("night");
      expect(daylightAt(atHour(h)).isMoon, `hour ${h}`).toBe(true);
    }
    expect(daylightAt(atHour(2)).overlayAlpha).toBeCloseTo(
      tuning.liveliness.daylight.overlayAlpha.night,
      6,
    );
  });

  it("swings the light across the sky, so shadows have something to skew to", () => {
    expect(daylightAt(atHour(6)).sunAngle).toBeLessThan(0);
    expect(daylightAt(atHour(18)).sunAngle).toBeGreaterThan(0.5);
  });

  it("applies an explicit extra shift on top of the clock", () => {
    const noon = atHour(12);
    expect(daylightAt(noon).phase).toBe("day");
    expect(daylightAt(noon, 11 * 3_600_000).phase).toBe("night");
  });

  it("⚠️ READS THE WALL CLOCK ALONE — no hidden day-boundary offset", () => {
    // THE REGRESSION THIS PINS, found in the browser and not by any unit
    // test: `app/main.ts` passed `state.dayOffsetMs` as the second
    // argument, on the bible's description of it as a "debug shift". It is
    // not one — `core/clock.ts`'s `localDayOffsetMs` returns
    // `dayStartHour·1h + getTimezoneOffset()·60_000`, the offset that puts
    // the STREAK's day boundary at local 04:00 — and `daylightAt` already
    // reads a LOCAL hour. On a UTC-4 machine that is +8 h, and the Keep
    // rendered deep night at 15:40 in the afternoon.
    //
    // The guard: for the default call, the phase must match the phase of
    // the host's own local hour. Any implementation that silently folds in
    // a boundary offset fails this on most of the world's timezones.
    const now = Date.now();
    expect(daylightAt(now).phase).toBe(phaseAt(localHourOf(now)).phase);
    expect(daylightAt(now).hour).toBeCloseTo(localHourOf(now), 4);
    // And a day-boundary-sized offset must be a VISIBLE difference, so
    // this test cannot pass by both sides being wrong together.
    const dayBoundaryish = 8 * 3_600_000;
    expect(daylightAt(atHour(15)).phase).not.toBe(
      daylightAt(atHour(15), dayBoundaryish).phase,
    );
  });
});

describe("daylightChangedEnough", () => {
  it("always redraws the first sample", () => {
    expect(daylightChangedEnough(null, daylightAt(atHour(12)))).toBe(true);
  });

  it("does NOT redraw for a one-second step — drawBackground is a teardown", () => {
    const a = daylightAt(atHour(12));
    const b = daylightAt(atHour(12) + 1000);
    expect(daylightChangedEnough(a, b)).toBe(false);
  });

  it("redraws on a phase flip even when the colours are mid-fade", () => {
    const a = daylightAt(atHour(16.99));
    const b = daylightAt(atHour(17.01));
    expect(a.phase).not.toBe(b.phase);
    expect(daylightChangedEnough(a, b)).toBe(true);
  });

  it("fires on ~0.1% of samples across a whole day, not on every one", () => {
    // THE CLAIM UNDER TEST is bible §4.2's "drawBackground is NOT called
    // per sample" — made measurable rather than assumed. Sampled at the
    // real 1 Hz rate for a full day: 86 400 samples in, 94 teardowns out
    // (measured), i.e. one every ~15 wall minutes. The bible's own guess
    // was "every ~2 minutes"; the epsilon turns out to be kinder than
    // that. The bar below is set well clear of the measurement so a
    // palette retune does not fail the suite, but far enough under the
    // sample count to catch an epsilon that has been zeroed out.
    let redraws = 0;
    let samples = 0;
    let last = null as ReturnType<typeof daylightAt> | null;
    for (let ms = 0; ms < DAY_MS; ms += tuning.liveliness.daylight.sampleMs) {
      samples++;
      const s = daylightAt(localMidnight() + ms);
      if (daylightChangedEnough(last, s)) {
        redraws++;
        last = s;
      }
    }
    expect(samples).toBe(86_400);
    expect(redraws).toBeLessThan(300);
    expect(redraws / samples).toBeLessThan(0.005);
    // …and it must still actually track the sky, not sit frozen all day.
    expect(redraws).toBeGreaterThan(4);
  });
});

describe("mixHex", () => {
  it("returns the endpoints exactly at t=0 and t=1", () => {
    expect(mixHex("#102030", "#a0b0c0", 0)).toBe("#102030");
    expect(mixHex("#102030", "#a0b0c0", 1)).toBe("#a0b0c0");
  });

  it("clamps out-of-range t rather than extrapolating past a legal colour", () => {
    expect(mixHex("#000000", "#ffffff", -5)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 5)).toBe("#ffffff");
  });
});

/**
 * ⚠️ THE MUTATION GUARD (bible §4.2 / §7.5.5).
 *
 * These two tests are the reason `daylightAt` takes a number instead of a
 * clock. They drive the ramp through a `FakeClock` composed under the
 * SAME `OffsetClock` the debug menu skews, at an hour that is NOT the
 * hour the test host actually is — so an implementation that read
 * `Date.now()` would return the host's real phase and fail.
 */
describe("the injected clock is authoritative (a Date.now() mutation must fail here)", () => {
  it("reads the phase from the composed clock, not from the wall", () => {
    const fake = new FakeClock(atHour(2)); // deep night, whatever the host's real time
    const clock = new OffsetClock(fake, 0);
    expect(daylightAt(clock.now()).phase).toBe("night");

    fake.set(atHour(12));
    expect(daylightAt(clock.now()).phase).toBe("day");
  });

  it("THE DEBUG SLIDER MOVES THE SKY: skewing the clock turns the Keep to night", () => {
    const fake = new FakeClock(atHour(12));
    const clock = new OffsetClock(fake, 0);
    const before = daylightAt(clock.now());
    expect(before.phase).toBe("day");
    expect(before.overlayAlpha).toBe(0);

    // The debug menu's +12h button, exactly as it is wired in main.ts.
    clock.skew(12 * 3_600_000);
    const after = daylightAt(clock.now());

    expect(after.phase).toBe("night");
    expect(after.isMoon).toBe(true);
    expect(after.overlayAlpha).toBeGreaterThan(before.overlayAlpha);
    expect(luminance(after.skyTop)).toBeLessThan(luminance(before.skyTop));
  });

  it("walks the whole ramp under the composed clock and sees every phase", () => {
    const fake = new FakeClock(localMidnight());
    const clock = new OffsetClock(fake);
    const seen = new Set<DaylightPhase>();
    for (let h = 0; h < 24; h++) {
      seen.add(daylightAt(clock.now()).phase);
      clock.skew(3_600_000);
    }
    expect([...seen].sort()).toEqual(["dawn", "day", "dusk", "night"]);
  });
});

describe("localHourOf", () => {
  it("is a local-hour reading, monotonic within a day", () => {
    expect(localHourOf(atHour(0))).toBeCloseTo(0, 6);
    expect(localHourOf(atHour(13.5))).toBeCloseTo(13.5, 6);
  });
});

// --- helpers -------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function channelDistance(a: string, b: string): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / (3 * 255);
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

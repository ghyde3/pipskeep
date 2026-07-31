/**
 * TIME OF DAY (round 2K, docs/liveliness-bible.md §4.2) — the app layer's
 * answer to "what does the sky look like right now".
 *
 * ⚠️ THE PURITY CONTRACT, AND IT IS THE WHOLE REASON THIS FILE IS HERE.
 * `core/` never learns what time it is (CLAUDE.md hard rule 1, spec §2
 * rule 2). This module is a PURE FUNCTION OF A NUMBER: it never calls
 * `Date`, never calls a clock, and holds no state. `src/app/main.ts` calls
 * it with `appClock.now()` — the ONE shared `OffsetClock` — so the debug
 * menu's time skew moves the sky exactly the way it already moves
 * expedition timers. That is not a nice-to-have; it is the QA tool for the
 * whole feature, and `daylight.test.ts` drives the entire ramp through a
 * `FakeClock` composed under an `OffsetClock` so a mutation that reaches
 * for `Date.now()` here fails a test rather than shipping.
 *
 * FOUR ANCHORS, CONTINUOUSLY INTERPOLATED (bible §4.2). Four rather than
 * three (three cannot express dawn AND dusk, and dusk is the best-looking
 * moment in any cosy game) and rather than five (a placeholder-art game
 * cannot draw five distinguishable skies).
 *
 * ⚠️ DAY IS BYTE-IDENTICAL TO WHAT SHIPPED BEFORE THIS ROUND: `day`'s sky
 * colours ARE `content/palette.ts`'s `keepPalette.skyTop`/`skyBottom` and
 * its overlay alpha is exactly 0, so at the hour most players open the game
 * this round cannot have made the Keep look worse. Every other phase is a
 * departure FROM that, never a replacement OF it.
 *
 * The overlay alphas are legibility numbers, not taste ones — see
 * `tuning.liveliness.daylight.overlayAlpha`'s own comment. The tint is one
 * full-screen layer ABOVE the world, so it multiplies ground and Pips
 * together and contrast RATIOS survive, which is what
 * `content/palette.test.ts` actually pins.
 */

import { tuning } from "../content/tuning";
import { keepPalette } from "../content/palette";

export type DaylightPhase = "dawn" | "day" | "dusk" | "night";

export interface DaylightSample {
  /** The phase the local hour falls in. */
  readonly phase: DaylightPhase;
  /** 0..1 through that phase — used only for cross-fading, never for logic. */
  readonly blend: number;
  /** Local hour as a float (0..24), for tests and the debug readout. */
  readonly hour: number;
  /** Interpolated sky band colours (hex strings, Pixi-ready). */
  readonly skyTop: string;
  readonly skyMid: string;
  readonly skyBottom: string;
  /** The sun/moon disc: horizontal fraction of the view, size factor, tint. */
  readonly sunX: number;
  readonly sunY: number;
  readonly sunScale: number;
  readonly sunColor: string;
  /** True once the disc is the moon rather than the sun. */
  readonly isMoon: boolean;
  /** Full-screen overlay above the world. */
  readonly overlayColor: string;
  readonly overlayAlpha: number;
  /**
   * Where the light comes from, -1 (hard left) .. +1 (hard right). Drives
   * the shadow skew — two float writes per actor, and the single cheapest
   * thing that makes light read as REAL rather than as a filter.
   */
  readonly sunAngle: number;
  /** Lantern-motif items glow at this alpha (0 by day, 1 deep at night). */
  readonly lanternGlow: number;
}

/** One phase's authored look — the four rows of bible §4.2's table. */
interface PhaseAnchor {
  readonly skyTop: string;
  readonly skyMid: string;
  readonly skyBottom: string;
  readonly overlayColor: string;
  readonly sunColor: string;
  readonly sunX: number;
  readonly sunY: number;
  readonly sunScale: number;
  readonly isMoon: boolean;
  readonly sunAngle: number;
  readonly lanternGlow: number;
}

/**
 * ⚠️ `day` MUST stay byte-identical to `keepPalette` — it is read from the
 * palette rather than re-typed, so a future palette change moves the
 * daylight ramp with it instead of silently forking. `#dff0ef` is the
 * shipped mid band literal in `keepScene.drawBackground`.
 */
const ANCHORS: Readonly<Record<DaylightPhase, PhaseAnchor>> = {
  dawn: {
    skyTop: "#f6d2c4",
    skyMid: "#fce3d4",
    skyBottom: "#fdeede",
    overlayColor: "#ffd9b0",
    sunColor: "#ffd2a0",
    sunX: 0.22,
    sunY: 0.52,
    sunScale: 0.85,
    isMoon: false,
    sunAngle: -0.85,
    lanternGlow: 0.25,
  },
  day: {
    skyTop: keepPalette.skyTop,
    skyMid: "#dff0ef",
    skyBottom: keepPalette.skyBottom,
    overlayColor: "#ffffff",
    sunColor: keepPalette.sunGlow,
    sunX: 0.78,
    sunY: 0.34,
    sunScale: 1,
    isMoon: false,
    sunAngle: 0.35,
    lanternGlow: 0,
  },
  dusk: {
    skyTop: "#e0b4c8",
    skyMid: "#f2cbc0",
    skyBottom: "#ffe2c4",
    overlayColor: "#ffb26e",
    sunColor: "#ffc98a",
    sunX: 0.86,
    sunY: 0.56,
    sunScale: 0.9,
    isMoon: false,
    sunAngle: 0.9,
    lanternGlow: 0.75,
  },
  night: {
    skyTop: "#2f3b63",
    skyMid: "#41507a",
    skyBottom: "#55658f",
    overlayColor: "#24304f",
    sunColor: "#e9eeff",
    sunX: 0.7,
    sunY: 0.26,
    sunScale: 0.55,
    isMoon: true,
    sunAngle: 0.1,
    lanternGlow: 1,
  },
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Phase order round the clock, so a ramp can wrap night → dawn. */
const PHASE_ORDER: readonly DaylightPhase[] = ["dawn", "day", "dusk", "night"];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear colour mix. Exported for the scene's own tint blending. */
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * Local hour (0..24, fractional) for a wall-clock ms value.
 *
 * ⚠️ USES `Date` — and this is the ONE legitimate use in the module,
 * because converting an epoch ms to a LOCAL hour is exactly the platform
 * question `core/` is forbidden from asking and the app layer exists to
 * answer. The value passed in is always the injected clock's, never
 * `Date.now()`, which is what keeps the debug slider authoritative.
 * `daylight.test.ts` pins that: skewing the clock must move the phase.
 */
export function localHourOf(nowMs: number): number {
  const d = new Date(nowMs);
  return (
    d.getHours() +
    d.getMinutes() / 60 +
    d.getSeconds() / 3600 +
    d.getMilliseconds() / 3_600_000
  );
}

/**
 * Which phase an hour falls in, how far through it (0..1), and how many
 * hours long that phase is.
 *
 * `lengthHours` is not decoration: the phases are wildly unequal (day and
 * night are 9 h, dawn and dusk are 3 h), and `daylightAt`'s cross-fade
 * has to be a fixed WALL-CLOCK duration rather than a fraction of the
 * phase — see `FADE_HOURS` for the bug that taught us so.
 */
export function phaseAt(hour: number): {
  phase: DaylightPhase;
  blend: number;
  lengthHours: number;
} {
  const starts = tuning.liveliness.daylight.phaseStartHour;
  const h = ((hour % 24) + 24) % 24;
  // Ordered boundaries, wrapping: night runs from 20:00 through 05:00.
  const bounds: readonly { phase: DaylightPhase; from: number; to: number }[] = [
    { phase: "dawn", from: starts.dawn, to: starts.day },
    { phase: "day", from: starts.day, to: starts.dusk },
    { phase: "dusk", from: starts.dusk, to: starts.night },
  ];
  for (const b of bounds) {
    if (h >= b.from && h < b.to) {
      const length = b.to - b.from;
      return { phase: b.phase, blend: (h - b.from) / length, lengthHours: length };
    }
  }
  // Night wraps midnight: [night, 24) ∪ [0, dawn).
  const nightLength = 24 - starts.night + starts.dawn;
  const into = h >= starts.night ? h - starts.night : 24 - starts.night + h;
  return {
    phase: "night",
    blend: nightLength === 0 ? 0 : into / nightLength,
    lengthHours: nightLength,
  };
}

/**
 * How long the cross-fade into the NEXT phase lasts, in wall-clock hours.
 *
 * ⚠️ WALL-CLOCK, NOT A FRACTION OF THE PHASE — and this is a bug fix, not
 * a preference. The first cut faded over "the last third of each phase",
 * which sounds reasonable until you notice the phases are 3 h, 9 h, 3 h
 * and 9 h long: a third of the 9-hour day phase is SIX HOURS, so the sky
 * began turning sunset-pink at 14:00 and was 57% dusk by twenty to four in
 * the afternoon. Caught in the browser. The module's own doc had said the
 * right thing all along ("at 16:00 it is plain day, by 17:00 it is fully
 * dusk"); the code just did not implement it.
 *
 * One hour gives exactly that, and it degrades sensibly for the short
 * phases: dawn starts turning to day at 07:00, dusk to night at 19:00.
 * Capped at half a phase so a hypothetical sub-2-hour phase cannot spend
 * its whole life mid-fade.
 */
const FADE_HOURS = 1;

/**
 * The sample the scene consumes.
 *
 * Anchors are cross-faded over the LAST `FADE_HOURS` of each phase into
 * the next one, so the sky is continuous rather than four steps: at 16:00
 * it is plain day, by 17:00 it is fully dusk, and every minute in between
 * is a gradient rather than a cut.
 *
 * @param nowMs  wall ms from the injected `OffsetClock` (NEVER `Date.now()`).
 * @param extraShiftMs  an ADDITIONAL shift, in ms, on top of the clock.
 *   Defaults to 0 and **nothing in the app passes it** — it exists so the
 *   suite can walk the ramp without moving a clock.
 *
 *   ⚠️ DO NOT PASS `state.dayOffsetMs` HERE. The bible's §4.2 called it
 *   "2C's `SET_DAY_OFFSET` debug shift", and that is a misreading this
 *   round shipped once and caught in the browser: `dayOffsetMs` is NOT a
 *   debug time skew. It is `dayStartHour·1h + getTimezoneOffset()·60_000`
 *   (see `core/clock.ts`'s `localDayOffsetMs`) — the offset that puts the
 *   STREAK's day boundary at local 04:00. `localHourOf` below already
 *   converts to local time on its own, so adding it shifted the sky by
 *   four hours plus the timezone: on a UTC-4 machine at 15:40 in the
 *   afternoon, the Keep rendered deep night. The debug time slider needs
 *   no help from this parameter — it moves `clock.now()`, which is the
 *   whole input.
 */
export function daylightAt(nowMs: number, extraShiftMs = 0): DaylightSample {
  const hour = localHourOf(nowMs + extraShiftMs);
  const { phase, blend, lengthHours } = phaseAt(hour);
  const here = ANCHORS[phase];
  // Cross-fade into the next phase over the last FADE_HOURS of this one.
  const fadeFraction =
    lengthHours > 0 ? Math.min(0.5, FADE_HOURS / lengthHours) : 0.5;
  const fadeFrom = 1 - fadeFraction;
  const nextPhase =
    PHASE_ORDER[(PHASE_ORDER.indexOf(phase) + 1) % PHASE_ORDER.length] ?? phase;
  const there = ANCHORS[nextPhase];
  const t = blend <= fadeFrom ? 0 : (blend - fadeFrom) / fadeFraction;

  const alphas = tuning.liveliness.daylight.overlayAlpha;
  return {
    phase,
    blend,
    hour,
    skyTop: mixHex(here.skyTop, there.skyTop, t),
    skyMid: mixHex(here.skyMid, there.skyMid, t),
    skyBottom: mixHex(here.skyBottom, there.skyBottom, t),
    sunX: lerp(here.sunX, there.sunX, t),
    sunY: lerp(here.sunY, there.sunY, t),
    sunScale: lerp(here.sunScale, there.sunScale, t),
    sunColor: mixHex(here.sunColor, there.sunColor, t),
    // The disc flips identity at the midpoint of the fade rather than
    // cross-fading "sunness" — half a moon is not a thing.
    isMoon: t < 0.5 ? here.isMoon : there.isMoon,
    overlayColor: mixHex(here.overlayColor, there.overlayColor, t),
    overlayAlpha: lerp(alphas[phase], alphas[nextPhase], t),
    sunAngle: lerp(here.sunAngle, there.sunAngle, t),
    lanternGlow: lerp(here.lanternGlow, there.lanternGlow, t),
  };
}

/**
 * Has the sky moved enough to be worth a `drawBackground()` teardown?
 *
 * `drawBackground` rebuilds the whole background container, so it must NOT
 * run per sample (1 Hz) let alone per frame. Comparing the two samples'
 * colours against `redrawEpsilon` means it fires roughly every two wall
 * minutes — bible §4.2's "not called per sample" requirement, made
 * measurable rather than assumed.
 */
export function daylightChangedEnough(
  a: DaylightSample | null,
  b: DaylightSample,
): boolean {
  if (a === null) return true;
  if (a.phase !== b.phase || a.isMoon !== b.isMoon) return true;
  const eps = tuning.liveliness.daylight.redrawEpsilon;
  const dist = (x: string, y: string): number => {
    const [xr, xg, xb] = hexToRgb(x);
    const [yr, yg, yb] = hexToRgb(y);
    return (Math.abs(xr - yr) + Math.abs(xg - yg) + Math.abs(xb - yb)) / (3 * 255);
  };
  return (
    dist(a.skyTop, b.skyTop) > eps ||
    dist(a.skyBottom, b.skyBottom) > eps ||
    Math.abs(a.sunX - b.sunX) > eps ||
    Math.abs(a.sunY - b.sunY) > eps
  );
}

/** Exported for tests: the ms in a day, so a suite can walk a full ramp. */
export const DAY_MS = MS_PER_DAY;

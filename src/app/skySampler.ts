/**
 * ⚠️ ROUND 2K FIX STAGE — THE SKY SAMPLER, EXTRACTED SO IT CAN BE TESTED.
 *
 * `daylight.ts` has an excellent explicit mutation guard for its own
 * module ("the injected clock is authoritative — a `Date.now()` mutation
 * must fail here"), and it works: making `daylightAt` read `Date.now()`
 * fails eleven tests. But the guard stopped at the module boundary. The
 * CALL SITE — four lines inside `main.ts`'s `boot()` — was reachable by no
 * test at all, and a mutation that changed
 *
 *     const now = clock.now();   →   const now = Date.now();
 *
 * left 139 files and 3 566 tests green while silently disconnecting the
 * debug time slider from the sky. `daylight.ts`'s own doc calls that
 * slider "the QA tool for the whole feature", and `main.ts` carries a
 * comment recording that the PREVIOUS bug in this exact expression was
 * "caught in the browser, not by a test".
 *
 * Twice is a pattern, so the expression moved somewhere a test can reach
 * it. This is round 2I's `pushWiring.test.ts` lesson applied to the second
 * composition-root seam: a module test proves the function is right, only
 * a seam test proves the wiring is.
 *
 * App layer, not core: it reads a `Clock` and hands samples to the scene.
 * Core purity is untouched — no core module imports this.
 */

import type { Clock } from "../core/clock";
import { daylightAt } from "./daylight";
import type { DaylightSample } from "./daylight";
import { weatherAt } from "./weather";
import type { WeatherSample } from "./weather";

/** The slice of the scene the sampler drives. `render/keepScene.ts`'s
 * `KeepScene` satisfies this structurally; the narrow shape is what lets
 * a test hand it a recorder instead of a canvas. */
export interface SkyTarget {
  setDaylight(sample: DaylightSample): void;
  setWeather(sample: WeatherSample): void;
}

/**
 * Build the "push the current sky at the scene" callback.
 *
 * ⚠️ `clock.now()` AND NOTHING ELSE — never `Date.now()`, and never with
 * `state.dayOffsetMs` added. That offset is
 * `dayStartHour·1h + getTimezoneOffset()·60_000` (core/clock.ts's
 * `localDayOffsetMs`), the thing that puts the STREAK's day boundary at
 * local 04:00, and `daylightAt` already reads a LOCAL hour. An earlier cut
 * added it on the bible's description of it as a debug shift; the sky
 * moved four hours plus the timezone and the Keep rendered deep night at
 * twenty to four in the afternoon.
 *
 * `seedOf` is a thunk rather than a number because the store's state is
 * replaced on every dispatch — the sampler must read the CURRENT seed at
 * call time, exactly as the inline version did.
 */
export function createSkySampler(
  clock: Clock,
  target: SkyTarget,
  seedOf: () => number,
): () => void {
  return (): void => {
    const now = clock.now();
    target.setDaylight(daylightAt(now));
    target.setWeather(weatherAt(seedOf(), now));
  };
}

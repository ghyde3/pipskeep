/**
 * WEATHER (round 2K, docs/liveliness-bible.md §4.3) — the app layer's
 * answer to "what is the sky doing right now".
 *
 * ⚠️ WEATHER HAS NO MECHANICAL EFFECT OF ANY KIND, AND THAT IS THE WHOLE
 * DESIGN (bible §4.3's invariant I4). Three arguments, each sufficient:
 *
 *  1. 2C §0.4's isolation rule — weather that changed decay, restore,
 *     loot or egg odds would silently re-derive `balance.test.ts`'s
 *     central claim. The rule exists because that has happened.
 *  2. 2H's shield one, "no hidden risk, ever" — weather that raised
 *     ailment risk would be risk the send-off card cannot state, and it
 *     would fire while the player was away (promise 2).
 *  3. The player cannot control it. A cosy game must never make an
 *     uncontrollable thing cost something. "Wait for good weather before
 *     sending a Pip out" is a mechanic from a different genre.
 *
 * The tempting exception — *"rain makes Pips cleaner"* — is refused: it
 * is a `care.*` touch, positive-only today and a balance dependency
 * tomorrow, and it would make players WAIT FOR RAIN.
 *
 * ⚠️ THE ENFORCEMENT IS A TEST, NOT A PROMISE. This module lives in
 * `src/app/` and `weather.test.ts` greps every file under `src/core/`
 * for an import of it. Same shape as the existing purity greps. If a
 * future round wants weather to matter, it has to delete that test in
 * the open.
 *
 * DERIVED, NEVER STORED. One weather per `windowMs` window, hashed from
 * `(saveSeed, windowIndex)`: no `GameState` field, no RNG cursor, no
 * migration, no save cost, deterministic across reloads — and it moves
 * with the debug time slider for free, because the caller passes the
 * injected `OffsetClock`'s `now()` exactly as `daylightAt` does.
 *
 * Cosmetic randomness from a fixed local hash rather than a `GameState`
 * cursor is the repo's established rule for render-only juice (see
 * `render/keepScene.ts`'s jitter stream and `render/particles.ts`).
 */

import { fnv1a } from "../core/rng";
import { tuning } from "../content/tuning";

export type WeatherKind = "clear" | "overcast" | "rain" | "snow" | "petalfall";

/** The weight table's shape. Taken as a PARAMETER by `weatherAt` — the
 * named seam for 2C's `EVENTS` to bias a recurring season later (bible
 * §7.8). Nothing passes a non-default table this round. */
export type WeatherWeights = Readonly<Record<WeatherKind, number>>;

/** Declaration order is the tie-break order for the weighted pick, so it
 * is pinned here rather than left to `Object.keys` on the tuning literal. */
export const WEATHER_KINDS: readonly WeatherKind[] = [
  "clear",
  "overcast",
  "rain",
  "snow",
  "petalfall",
];

export interface WeatherSample {
  readonly kind: WeatherKind;
  /** Which `windowMs` window this is — the value that changes when the
   * weather does. Exported so the scene can rebuild an emitter on the
   * edge instead of comparing kinds (two adjacent windows can roll the
   * same kind, and rebuilding then would be a pointless teardown). */
  readonly window: number;
  /** 0..1 through the window. Drives the fade-in/fade-out at the edges so
   * rain arrives rather than appearing. */
  readonly progress: number;
  /** Sky desaturation, 0..1 — `overcast` is the only non-zero one. */
  readonly desaturate: number;
  /** Multiplier on the sun/moon glow's alpha. */
  readonly sunGlowScale: number;
  /** How many particles this weather wants. 0 for clear/overcast. */
  readonly particleCount: number;
}

/**
 * The weather for a moment, derived from the save seed and the clock.
 *
 * @param saveSeed  `GameState.seed` — so two different saves get
 *   different weather at the same instant, and one save gets the SAME
 *   weather at that instant on every reload and every device.
 * @param nowMs  wall ms from the injected `OffsetClock` (NEVER
 *   `Date.now()` — the debug slider must move the weather too).
 * @param weights  the seam of bible §7.8. Defaults to tuning's table.
 */
export function weatherAt(
  saveSeed: number,
  nowMs: number,
  weights: WeatherWeights = tuning.liveliness.weather.weights,
): WeatherSample {
  const windowMs = tuning.liveliness.weather.windowMs;
  const window = Math.floor(nowMs / windowMs);
  const kind = pickWeighted(weights, fnv1a(`${saveSeed}|${window}`));
  const into = nowMs - window * windowMs;
  const progress = windowMs === 0 ? 0 : clamp01(into / windowMs);
  const counts = tuning.liveliness.weather.particleCount;
  return {
    kind,
    window,
    progress,
    desaturate: kind === "overcast" ? 0.12 : 0,
    sunGlowScale: kind === "overcast" ? 0.35 : kind === "rain" ? 0.5 : 1,
    particleCount:
      kind === "rain"
        ? counts.rain
        : kind === "snow"
          ? counts.snow
          : kind === "petalfall"
            ? counts.petalfall
            : 0,
  };
}

/**
 * Does this weather send Pips looking for cover?
 *
 * ⚠️ READ THE MODULE DOC BEFORE ASSUMING THIS IS A MECHANIC. Sheltering
 * is a BEHAVIOUR, not an effect: a sheltering Pip's needs, decay, mood,
 * job production and expedition eligibility are all byte-identical to a
 * wandering one's. It changes where the actor stands, and nothing else.
 * It is also the single best thing in §4.3 — Pips running for the arch
 * when it rains is worth more than the rain is, and it costs nothing
 * because it shares the target-picking branch §4.4 adds anyway.
 */
export function seeksShelter(kind: WeatherKind): boolean {
  return kind === "rain";
}

/** Does a passing Pip leave a mark? (snow → footprints.) */
export function leavesFootprints(kind: WeatherKind): boolean {
  return kind === "snow";
}

/** Is there something in the air worth batting at? (petalfall.) */
export function invitesPlay(kind: WeatherKind): boolean {
  return kind === "petalfall";
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Weighted pick from a 32-bit hash. Deliberately NOT `core/rng`'s stream
 * API: a stream carries a cursor that would have to live in `GameState`,
 * and weather having zero save cost is the point (bible §4.3).
 */
function pickWeighted(weights: WeatherWeights, hash: number): WeatherKind {
  let total = 0;
  for (const k of WEATHER_KINDS) total += Math.max(0, weights[k]);
  if (total <= 0) return "clear";
  // hash >>> 0 is already unsigned; scale into [0, total).
  let roll = (hash / 0x1_0000_0000) * total;
  for (const k of WEATHER_KINDS) {
    roll -= Math.max(0, weights[k]);
    if (roll < 0) return k;
  }
  return "clear";
}

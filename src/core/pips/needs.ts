/**
 * Needs decay/regen math (spec §4.1, §4.2, §4.6).
 *
 * Pure functions: no clock access — callers (game loop, catch-up pass)
 * compute elapsed hours from the injected `Clock` and pass them in.
 *
 * ZERO tuning literals live here; every number is read from the tuning
 * object (defaults to `content/tuning.ts`, injectable for tests). The only
 * numeric constants below are mathematical/structural: the ×1 identity
 * multiplier, the ÷2 of the trapezoid rule, and the 0–100 need bounds
 * (NEED_MIN/NEED_MAX from types.ts).
 */

import { HOUR_MS, tuning as contentTuning } from "../../content/tuning";
import {
  LifeStage,
  NEED_IDS,
  NEED_MAX,
  NEED_MIN,
  PipActivity,
} from "./types";
import type { NeedId, PipNeeds, PipState } from "./types";

/**
 * The slice of tuning the needs math reads. Structural (rather than the
 * full `Tuning` type) so tests can pass direct rate params — e.g. a
 * neutral all-×1.0 personality — without polluting content/ with test data.
 * `personalityDecayMultipliers` is keyed by string because core treats
 * personality ids as opaque content ids.
 */
export interface NeedsTuning {
  readonly needDecayPerHour: Readonly<Record<NeedId, number>>;
  readonly personalityDecayMultipliers: Readonly<
    Record<string, Readonly<Record<NeedId, number>>>
  >;
  readonly quirks: {
    readonly clingyExpeditionHappinessMultiplier: number;
  };
  readonly pipling: { readonly decayMultiplier: number };
  readonly care: {
    readonly rest: { readonly energyPerHour: number };
  };
}

/** Signed per-need rate in points per real-time hour. Negative = decays. */
export type NeedRates = Record<NeedId, number>;

/** Personality id whose quirk gives ×2.0 happiness decay while away (§4.2). */
const CLINGY_PERSONALITY_ID = "clingy";

/**
 * Effective per-need rates for the Pip's CURRENT activity/life stage:
 * base × personality × life-stage × situational, all multiplicative
 * (spec §4.1). Multiplication is applied in exactly that order so tests
 * can assert exact float equality against the same product expression.
 *
 * Situational modifiers implemented here:
 * - Clingy: happiness decay × quirks.clingyExpeditionHappinessMultiplier
 *   while OnExpedition or Returning (spec §4.2 — the whole time away).
 * - Resting: the energy rate is REPLACED by the flat
 *   `care.rest.energyPerHour` regen (spec §4.1's "+15 while Resting",
 *   amended in round 2A — the rate is whatever tuning says, today 600/h
 *   so a nap is measured in minutes).
 *   Decision: personality/life-stage multipliers do NOT apply to regen —
 *   spec §4.2 says modifiers are "multipliers on base decay", and §4.5
 *   needs Rest auto-wake to be a simply computable moment. Other needs
 *   keep decaying normally while Resting (§4.7: decay in every state).
 */
export function effectiveRates(
  pip: PipState,
  tuning: NeedsTuning = contentTuning,
): NeedRates {
  const personality = tuning.personalityDecayMultipliers[pip.personalityId];
  if (personality === undefined) {
    throw new Error(
      `effectiveRates: unknown personalityId "${pip.personalityId}" (not in tuning.personalityDecayMultipliers)`,
    );
  }

  // Adults have no life-stage modifier; only Piplings do (spec §4.6).
  // ×1 is the multiplicative identity, not a tunable.
  const lifeStageMultiplier =
    pip.lifeStage === LifeStage.Pipling ? tuning.pipling.decayMultiplier : 1;

  const away =
    pip.activity === PipActivity.OnExpedition ||
    pip.activity === PipActivity.Returning;

  const rates = {} as NeedRates;
  for (const need of NEED_IDS) {
    const situational =
      need === "happiness" &&
      away &&
      pip.personalityId === CLINGY_PERSONALITY_ID
        ? tuning.quirks.clingyExpeditionHappinessMultiplier
        : 1;
    rates[need] =
      tuning.needDecayPerHour[need] *
      personality[need] *
      lifeStageMultiplier *
      situational;
  }

  if (pip.activity === PipActivity.Resting) {
    rates.energy = tuning.care.rest.energyPerHour;
  }

  return rates;
}

const clampNeed = (value: number): number =>
  Math.min(NEED_MAX, Math.max(NEED_MIN, value));

/**
 * Integral of a clamped linear happiness trajectory, in happiness·hours.
 * h(t) = clamp(h0 + rate·t, 0..100) integrated over t ∈ [0, hours].
 *
 * Documented choice (spec §4.6 "time-weighted sum"): this is the EXACT
 * integral of the piecewise-linear clamped path — identical to the
 * trapezoid rule while unclamped, and correct (not merely approximate)
 * when happiness pins at 0 or 100 partway through the interval. Callers
 * that advance in segments (catch-up, §4.5) therefore accrue the same
 * total regardless of how the interval is subdivided.
 */
function happinessAreaHours(h0: number, rate: number, hours: number): number {
  if (hours <= 0) return 0;
  if (rate === 0) return h0 * hours;
  const bound = rate > 0 ? NEED_MAX : NEED_MIN;
  const hoursToBound = (bound - h0) / rate;
  if (hoursToBound >= hours) {
    // Never clamps inside the interval → plain trapezoid, which is exact
    // for a linear path: average of endpoints × duration.
    return ((h0 + (h0 + rate * hours)) / 2) * hours;
  }
  // Linear until the bound, then flat at the bound.
  return ((h0 + bound) / 2) * hoursToBound + bound * (hours - hoursToBound);
}

/**
 * Advance a Pip's needs by `hours` of continuous time in its CURRENT
 * activity/life stage. Pure — returns a new PipState.
 *
 * - Needs move by effectiveRates × hours, clamped to [0, 100].
 * - `ageMs` and `happinessIntegral` accrue (spec §4.6); the integral uses
 *   the exact clamped-trapezoid area (see happinessAreaHours) in
 *   happiness·ms, so lifetime average = happinessIntegral / ageMs.
 * - `needsUpdatedAt` advances by exactly the elapsed ms.
 *
 * Negative `hours` clamps to 0 (spec §4.5: never apply negative decay).
 * Callers crossing an activity/stage boundary must split the interval at
 * the boundary and call once per segment (spec §4.5 segmentation).
 */
export function applyNeedsDelta(
  pip: PipState,
  hours: number,
  tuning: NeedsTuning = contentTuning,
): PipState {
  const h = Math.max(0, hours);
  const elapsedMs = h * HOUR_MS;
  const rates = effectiveRates(pip, tuning);

  const needs = {} as PipNeeds;
  for (const need of NEED_IDS) {
    needs[need] = clampNeed(pip.needs[need] + rates[need] * h);
  }

  return {
    ...pip,
    needs,
    ageMs: pip.ageMs + elapsedMs,
    happinessIntegral:
      pip.happinessIntegral +
      happinessAreaHours(pip.needs.happiness, rates.happiness, h) * HOUR_MS,
    needsUpdatedAt: pip.needsUpdatedAt + elapsedMs,
  };
}

/**
 * Advance a Pip through RATE-FROZEN time (the portion of an absence past
 * the offline rate cap, spec §4.5 rule 3). Needs do not move, but time
 * still passes: `ageMs` keeps accruing and `happinessIntegral` accrues at
 * the frozen happiness value (spec §4.6: "during rate-frozen catch-up
 * segments the frozen value keeps accruing"). `needsUpdatedAt` advances so
 * subsequent segments line up. Negative `hours` clamps to 0.
 */
export function accrueFrozenTime(pip: PipState, hours: number): PipState {
  const h = Math.max(0, hours);
  const elapsedMs = h * HOUR_MS;
  return {
    ...pip,
    ageMs: pip.ageMs + elapsedMs,
    happinessIntegral:
      pip.happinessIntegral + pip.needs.happiness * h * HOUR_MS,
    needsUpdatedAt: pip.needsUpdatedAt + elapsedMs,
  };
}

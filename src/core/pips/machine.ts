/**
 * Pip state machine (spec §4.7) — pure transition functions with legality
 * checks.
 *
 * ```
 * Idle ⇄ Resting
 * Idle → AssignedJob → Idle
 * Idle → OnExpedition → Returning → Idle
 * Idle | Resting | AssignedJob → Sulking → Idle
 * ```
 *
 * Player/system-initiated transitions return a `TransitionResult` — a typed
 * refusal, never an exception, when the move is not legal (spec §4.7:
 * Sulking Pips refuse Job/Expedition assignment; a `kind: "sulking"` or
 * `"pipling"` refusal is dialogue-worthy and maps to the Refusal dialogue
 * context of spec §3, while `"illegal"` marks a structurally impossible
 * move the UI should never have offered).
 *
 * Automatic transitions (Sulking entry/exit, Rest auto-wake) are exposed as
 * `evaluate*` functions that callers run after every needs recompute and at
 * every catch-up segment boundary (spec §4.5 rule 5). They take and return
 * `PipState` directly — they are re-evaluations, not requests, so they
 * cannot be refused.
 *
 * ZERO tuning literals: thresholds come from the tuning object (defaults to
 * `content/tuning.ts`, injectable for tests). The Sulking entry floor is
 * NEED_MIN (0) — spec-structural (§4.4 is a hard tone rule), not a tunable.
 */

import { HOUR_MS, tuning as contentTuning } from "../../content/tuning";
import { LifeStage, NEED_IDS, NEED_MIN, PipActivity } from "./types";
import type { ActiveExpedition, PipState } from "./types";

/**
 * The slice of tuning the state machine reads. Structural so tests can
 * inject values without touching content/ (same pattern as NeedsTuning).
 */
export interface MachineTuning {
  /** Sulking exit: ALL four needs ≥ this, inclusive (spec §4.4). */
  readonly sulkExitThreshold: number;
  readonly care: {
    readonly rest: {
      /** Flat Energy regen per hour while Resting (spec §4.1). */
      readonly energyPerHour: number;
      /** Resting Pip auto-wakes the moment Energy reaches this (spec §5). */
      readonly autoWakeAtEnergy: number;
    };
  };
}

/** Requested transitions (also used as the `attempted` tag in refusals). */
export type TransitionName =
  | "beginRest"
  | "wake"
  | "assignJob"
  | "unassignJob"
  | "departExpedition"
  | "beginReturn"
  | "arriveHome";

/**
 * Why a transition was refused:
 * - `"sulking"` — a Sulking Pip declining Job/Expedition assignment
 *   (spec §4.4/§4.7); draw a line from the Refusal dialogue context.
 * - `"pipling"` — Piplings cannot go on expeditions (spec §4.6).
 * - `"illegal"` — not a legal edge from the current activity; the UI
 *   should not have offered it.
 */
export type RefusalKind = "sulking" | "pipling" | "illegal";

export interface TransitionRefusal {
  readonly kind: RefusalKind;
  readonly attempted: TransitionName;
  /** The Pip's activity at the moment of refusal. */
  readonly activity: PipActivity;
}

/**
 * Outcome of a requested transition. Refusals cost nothing: the caller's
 * PipState is untouched (all functions here are pure) and no cooldown or
 * stat change is implied (spec §5).
 */
export type TransitionResult =
  | { readonly ok: true; readonly pip: PipState }
  | { readonly ok: false; readonly refusal: TransitionRefusal };

const allow = (pip: PipState): TransitionResult => ({ ok: true, pip });

const refuse = (
  kind: RefusalKind,
  attempted: TransitionName,
  pip: PipState,
): TransitionResult => ({
  ok: false,
  refusal: { kind, attempted, activity: pip.activity },
});

/** Idle → Resting (spec §4.7; the Rest care action's "on" toggle). */
export function beginRest(pip: PipState): TransitionResult {
  if (pip.activity !== PipActivity.Idle) {
    return refuse("illegal", "beginRest", pip);
  }
  return allow({ ...pip, activity: PipActivity.Resting });
}

/** Resting → Idle (manual wake; auto-wake is evaluateRestAutoWake). */
export function wake(pip: PipState): TransitionResult {
  if (pip.activity !== PipActivity.Resting) {
    return refuse("illegal", "wake", pip);
  }
  return allow({ ...pip, activity: PipActivity.Idle });
}

/** Idle → AssignedJob. Sulking Pips refuse with dialogue (spec §4.7). */
export function assignJob(pip: PipState): TransitionResult {
  if (pip.activity === PipActivity.Sulking) {
    return refuse("sulking", "assignJob", pip);
  }
  if (pip.activity !== PipActivity.Idle) {
    return refuse("illegal", "assignJob", pip);
  }
  return allow({ ...pip, activity: PipActivity.AssignedJob });
}

/** AssignedJob → Idle (player unassigns; jobs have no natural end, §6.2). */
export function unassignJob(pip: PipState): TransitionResult {
  if (pip.activity !== PipActivity.AssignedJob) {
    return refuse("illegal", "unassignJob", pip);
  }
  return allow({ ...pip, activity: PipActivity.Idle });
}

/**
 * Idle → OnExpedition. The machine owns the `expedition` field so the
 * invariant "non-null exactly while OnExpedition/Returning" holds by
 * construction. Sulking Pips refuse (spec §4.7); Piplings cannot go on
 * expeditions (spec §4.6).
 */
export function departExpedition(
  pip: PipState,
  expedition: ActiveExpedition,
): TransitionResult {
  if (pip.activity === PipActivity.Sulking) {
    return refuse("sulking", "departExpedition", pip);
  }
  if (pip.activity !== PipActivity.Idle) {
    return refuse("illegal", "departExpedition", pip);
  }
  if (pip.lifeStage === LifeStage.Pipling) {
    return refuse("pipling", "departExpedition", pip);
  }
  return allow({ ...pip, activity: PipActivity.OnExpedition, expedition });
}

/** OnExpedition → Returning (duration elapsed; keeps `expedition` so loot
 * can still be resolved from it on arrival). */
export function beginReturn(pip: PipState): TransitionResult {
  if (pip.activity !== PipActivity.OnExpedition) {
    return refuse("illegal", "beginReturn", pip);
  }
  return allow({ ...pip, activity: PipActivity.Returning });
}

/**
 * Returning → Idle. If a need hit 0 while away (`pendingSulk`), the Pip
 * enters Sulking the moment it lands (spec §4.4) — the expedition itself
 * completed normally with full loot; callers resolve loot from
 * `pip.expedition` BEFORE calling this, since arrival clears it.
 */
export function arriveHome(pip: PipState): TransitionResult {
  if (pip.activity !== PipActivity.Returning) {
    return refuse("illegal", "arriveHome", pip);
  }
  return allow({
    ...pip,
    activity: pip.pendingSulk ? PipActivity.Sulking : PipActivity.Idle,
    pendingSulk: false,
    expedition: null,
  });
}

/**
 * Automatic Sulking entry/exit (spec §4.4). Run after every needs
 * recompute and at every catch-up segment boundary (spec §4.5 rule 5).
 *
 * - Exit: Sulking and ALL four needs ≥ sulkExitThreshold (inclusive) → Idle.
 * - Enter: any need at the floor (0) while Idle/Resting/AssignedJob →
 *   Sulking. While OnExpedition/Returning the entry is deferred: set
 *   `pendingSulk` and leave the activity alone (never punish the trip);
 *   arriveHome converts it to Sulking on landing.
 */
export function evaluateSulk(
  pip: PipState,
  tuning: MachineTuning = contentTuning,
): PipState {
  if (pip.activity === PipActivity.Sulking) {
    const recovered = NEED_IDS.every(
      (need) => pip.needs[need] >= tuning.sulkExitThreshold,
    );
    return recovered ? { ...pip, activity: PipActivity.Idle } : pip;
  }

  const anyAtFloor = NEED_IDS.some((need) => pip.needs[need] <= NEED_MIN);
  if (!anyAtFloor) return pip;

  if (
    pip.activity === PipActivity.OnExpedition ||
    pip.activity === PipActivity.Returning
  ) {
    return pip.pendingSulk ? pip : { ...pip, pendingSulk: true };
  }

  // Idle / Resting / AssignedJob — enter Sulking now (spec §4.4).
  return { ...pip, activity: PipActivity.Sulking };
}

/**
 * Automatic Rest wake (spec §5: "Pip auto-wakes at 100"): a Resting Pip
 * whose Energy has reached `autoWakeAtEnergy` → Idle. Run after every
 * needs recompute; catch-up passes split segments at restAutoWakeAt() so
 * Energy is at exactly the threshold (never beyond) at the wake moment.
 */
export function evaluateRestAutoWake(
  pip: PipState,
  tuning: MachineTuning = contentTuning,
): PipState {
  if (pip.activity !== PipActivity.Resting) return pip;
  if (pip.needs.energy < tuning.care.rest.autoWakeAtEnergy) return pip;
  return { ...pip, activity: PipActivity.Idle };
}

/**
 * The computable auto-wake moment (spec §4.5 rule 1: catch-up collects it
 * as a timed event): the absolute timestamp at which a Resting Pip's
 * Energy reaches `autoWakeAtEnergy`, i.e.
 * `needsUpdatedAt + (autoWakeAtEnergy − energy) / energyPerHour` hours.
 * `null` when the Pip is not Resting; already-due wakes (Energy at or past
 * the threshold) return `needsUpdatedAt`.
 */
export function restAutoWakeAt(
  pip: PipState,
  tuning: MachineTuning = contentTuning,
): number | null {
  if (pip.activity !== PipActivity.Resting) return null;
  const { energyPerHour, autoWakeAtEnergy } = tuning.care.rest;
  const deficit = autoWakeAtEnergy - pip.needs.energy;
  if (deficit <= 0) return pip.needsUpdatedAt;
  return pip.needsUpdatedAt + (deficit / energyPerHour) * HOUR_MS;
}

/**
 * Care actions (Feed/Clean/Play/Pet/Rest/Give Item) are legal only in
 * Idle, Resting, Sulking — not while away (spec §4.7). Sulking is
 * deliberately included: recovery is always one good care session away
 * (spec §4.4). Note the Rest toggle additionally needs the beginRest/wake
 * edges, which only exist between Idle and Resting.
 */
export const CARE_LEGAL_ACTIVITIES: readonly PipActivity[] = [
  PipActivity.Idle,
  PipActivity.Resting,
  PipActivity.Sulking,
];

/** True when the Pip can receive care actions (spec §4.7). */
export function canReceiveCare(pip: PipState): boolean {
  return CARE_LEGAL_ACTIVITIES.includes(pip.activity);
}

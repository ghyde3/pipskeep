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
 *
 * ---
 *
 * ## Sulking: activity vs. flag (round 2A finding #2)
 *
 * Before this round, Sulking was purely a `PipActivity` enum value: any
 * floored need while Idle/Resting/AssignedJob REPLACED `activity` with
 * `Sulking`, and `beginRest` required `activity === Idle` to start a nap.
 * That made a Pip that Sulked at 0 Energy unable to Rest at all — Rest is
 * the ONLY source of Energy (spec §4.1), so it was a soft-lock: the
 * player's one good care session (§4.4's whole promise) had no path in.
 *
 * Simply letting `beginRest` accept `activity === Sulking` is not enough:
 * the instant Rest begins, Energy is still 0 (no time has passed), so the
 * very next `evaluateSulk` re-evaluation would see a floored need on a
 * `Resting` Pip and — under the old all-or-nothing model — immediately
 * flip `activity` back to `Sulking`, undoing the nap before it started.
 * The enum cannot represent "napping AND still sulking" on its own.
 *
 * DECISION: `PipState.sulking` is now the orthogonal, authoritative flag
 * for "is the §4.4 penalty active", decoupled from `activity`. Read it via
 * `isSulking(pip)` below, never by comparing `activity` directly:
 *
 * - The COMMON case (any need floors while Idle or AssignedJob) is
 *   UNCHANGED: `activity` still flips to `PipActivity.Sulking` (so every
 *   existing consumer of that comparison — dialogue context, rendering,
 *   job eviction in keep/jobs.ts — keeps working with zero changes), and
 *   `sulking` is set true alongside it (the two always agree here).
 * - The NEW case is Resting: a Pip that begins Rest FROM Sulking (or one
 *   that was already napping when an unrelated need floored) keeps
 *   `activity === Resting` — a Rest in progress is never interrupted, an
 *   explicit design choice: ending a nap early because a different need
 *   floored would be exactly the kind of punishment §4.4 rules out, and
 *   Energy climbing is itself progress toward the exit bar — while
 *   `sulking` alone carries the still-guilt-tripping truth. `wake()` and
 *   `evaluateRestAutoWake` both resolve a Resting Pip back to
 *   `PipActivity.Sulking` (not Idle) if it is still sulking when the nap
 *   ends, so the enum re-manifests the instant the Pip stops napping.
 * - Exit (`evaluateSulk`, all four needs ≥ threshold) clears the flag and,
 *   ONLY if `activity` was the `Sulking` display value, restores it to
 *   Idle; a Resting Pip that recovers mid-nap keeps napping.
 *
 * Net effect: `activity` stays exactly as informative as before for every
 * existing reader, `sulking` is additive, and the one previously
 * unrepresentable state (Resting + still sulking) is now real instead of
 * being silently discarded by re-entering Sulking every evaluation.
 */

import { HOUR_MS, tuning as contentTuning } from "../../content/tuning";
import { adultAt } from "./lifecycle";
import type { LifecycleTuning } from "./lifecycle";
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
  readonly pipling: {
    /** Pipling → Adult boundary (spec §4.6); read here only to stamp
     * `growsUpAt` on a Pipling's expedition refusal (superset of
     * `LifecycleTuning`, which `adultAt` actually reads). */
    readonly durationMs: number;
    /**
     * Expedition ids a Pipling may be sent on despite the §4.6 age gate —
     * the round 2A "supervised short trip" amendment (designer-approved;
     * see content/tuning.ts `pipling.allowedExpeditionIds`). Empty means
     * the spec default: no expeditions at all.
     */
    readonly allowedExpeditionIds: readonly string[];
  };
}

/**
 * The one true "is this Pip currently under the §4.4 Sulking penalty"
 * check — use this everywhere instead of comparing `activity` directly.
 * Recognizes BOTH encodings: the common `activity === Sulking` display
 * value, and the `sulking` flag that also covers "sulking while Resting"
 * (see the module doc above). `pip.sulking` is optional (`undefined` ≡
 * `false`) purely so fixtures that never touch the Resting overlap don't
 * need updating; every core-owned constructor sets it explicitly wherever
 * it matters.
 */
export function isSulking(pip: PipState): boolean {
  return pip.activity === PipActivity.Sulking || pip.sulking === true;
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
 * - `"pipling"` — the Pip is a Pipling and this expedition is not in its
 *   `tuning.pipling.allowedExpeditionIds` supervised-trip allowlist (spec
 *   §4.6, round 2A amendment — Piplings are no longer blanket-barred).
 * - `"illegal"` — not a legal edge from the current activity; the UI
 *   should not have offered it.
 */
export type RefusalKind = "sulking" | "pipling" | "illegal";

/**
 * Refusal detail, keyed by `kind` so callers get exactly the data needed
 * to write a helpful sentence (spec: refusals should draw a line, not
 * just block). `"pipling"` carries `growsUpAt` — the exact Pipling→Adult
 * timestamp (`lifecycle.ts` `adultAt`) — so the UI can render a live
 * countdown ("ready for real expeditions in 3h12m") instead of a bare no.
 */
export type TransitionRefusal =
  | {
      readonly kind: "sulking" | "illegal";
      readonly attempted: TransitionName;
      /** The Pip's activity at the moment of refusal. */
      readonly activity: PipActivity;
    }
  | {
      readonly kind: "pipling";
      readonly attempted: TransitionName;
      readonly activity: PipActivity;
      /** Absolute timestamp the Pip becomes an Adult (`hatchedAt +
       * pipling.durationMs`) — after which this same request would
       * succeed regardless of the expedition. */
      readonly growsUpAt: number;
    };

/**
 * Outcome of a requested transition. Refusals cost nothing: the caller's
 * PipState is untouched (all functions here are pure) and no cooldown or
 * stat change is implied (spec §5).
 */
export type TransitionResult =
  | { readonly ok: true; readonly pip: PipState }
  | { readonly ok: false; readonly refusal: TransitionRefusal };

const allow = (pip: PipState): TransitionResult => ({ ok: true, pip });

function refuse(
  kind: "sulking" | "illegal",
  attempted: TransitionName,
  pip: PipState,
): TransitionResult {
  return { ok: false, refusal: { kind, attempted, activity: pip.activity } };
}

function refusePipling(
  attempted: TransitionName,
  pip: PipState,
  tuning: LifecycleTuning,
): TransitionResult {
  return {
    ok: false,
    refusal: {
      kind: "pipling",
      attempted,
      activity: pip.activity,
      growsUpAt: adultAt(pip, tuning),
    },
  };
}

/**
 * Idle | Sulking → Resting (spec §4.7; the Rest care action's "on"
 * toggle). Legal from Sulking (round 2A fix, see module doc): the
 * resulting Pip keeps `sulking: true` — `activity` moves to `Resting` but
 * the guilt-trip persists until needs actually clear the exit bar
 * (`evaluateSulk`), and re-manifests as `PipActivity.Sulking` when the
 * nap ends if it still hasn't (`wake`/`evaluateRestAutoWake`).
 */
export function beginRest(pip: PipState): TransitionResult {
  const wasSulking = pip.activity === PipActivity.Sulking;
  if (pip.activity !== PipActivity.Idle && !wasSulking) {
    return refuse("illegal", "beginRest", pip);
  }
  return allow({
    ...pip,
    activity: PipActivity.Resting,
    ...(wasSulking ? { sulking: true } : {}),
  });
}

/**
 * Resting → Idle | Sulking (manual wake; auto-wake is
 * evaluateRestAutoWake, which shares this same target logic). Resolves to
 * `Sulking`, not `Idle`, if the Pip is STILL sulking when the nap ends
 * (round 2A: Rest cures Energy, nothing else — a Pip that woke with
 * another need still floored should visibly say so again).
 */
export function wake(pip: PipState): TransitionResult {
  if (pip.activity !== PipActivity.Resting) {
    return refuse("illegal", "wake", pip);
  }
  return allow({
    ...pip,
    activity: isSulking(pip) ? PipActivity.Sulking : PipActivity.Idle,
  });
}

/** Idle → AssignedJob. Sulking Pips refuse with dialogue (spec §4.7). */
export function assignJob(pip: PipState): TransitionResult {
  if (isSulking(pip)) {
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
 * construction. Sulking Pips refuse (spec §4.7); a Pipling refuses unless
 * this expedition id is in `tuning.pipling.allowedExpeditionIds` (spec
 * §4.6, round 2A "supervised short trip" amendment) — the refusal carries
 * `growsUpAt` so the UI can explain exactly when it resolves.
 */
export function departExpedition(
  pip: PipState,
  expedition: ActiveExpedition,
  tuning: MachineTuning = contentTuning,
): TransitionResult {
  if (isSulking(pip)) {
    return refuse("sulking", "departExpedition", pip);
  }
  if (pip.activity !== PipActivity.Idle) {
    return refuse("illegal", "departExpedition", pip);
  }
  if (
    pip.lifeStage === LifeStage.Pipling &&
    !tuning.pipling.allowedExpeditionIds.includes(expedition.expeditionId)
  ) {
    return refusePipling("departExpedition", pip, tuning);
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
    sulking: pip.pendingSulk,
    pendingSulk: false,
    expedition: null,
  });
}

/**
 * Automatic Sulking entry/exit (spec §4.4). Run after every needs
 * recompute and at every catch-up segment boundary (spec §4.5 rule 5).
 *
 * - Exit: sulking (either encoding, `isSulking`) and ALL four needs ≥
 *   sulkExitThreshold (inclusive) → clear the flag; a Pip DISPLAYED as
 *   Sulking returns to Idle, a Pip Resting-through-it just keeps napping
 *   (round 2A: Rest is never something recovery should cut short).
 * - Enter: any need at the floor (0) while Idle/AssignedJob → the classic
 *   `activity = Sulking` display (unchanged from before this round).
 *   While Resting (a nap already in progress, or one just begun FROM
 *   Sulking via `beginRest`) → set the `sulking` FLAG only, activity
 *   stays Resting (round 2A: this is the case the old enum-only model
 *   could not represent — see module doc). While OnExpedition/Returning
 *   the entry is deferred: set `pendingSulk` and leave the activity alone
 *   (never punish the trip); `arriveHome` converts it to Sulking on
 *   landing.
 */
export function evaluateSulk(
  pip: PipState,
  tuning: MachineTuning = contentTuning,
): PipState {
  if (isSulking(pip)) {
    const recovered = NEED_IDS.every(
      (need) => pip.needs[need] >= tuning.sulkExitThreshold,
    );
    if (!recovered) return pip;
    return {
      ...pip,
      sulking: false,
      activity:
        pip.activity === PipActivity.Sulking ? PipActivity.Idle : pip.activity,
    };
  }

  const anyAtFloor = NEED_IDS.some((need) => pip.needs[need] <= NEED_MIN);
  if (!anyAtFloor) return pip;

  if (
    pip.activity === PipActivity.OnExpedition ||
    pip.activity === PipActivity.Returning
  ) {
    return pip.pendingSulk ? pip : { ...pip, pendingSulk: true };
  }

  if (pip.activity === PipActivity.Resting) {
    // NEW (round 2A): never yank a Pip out of a Rest in progress just
    // because a DIFFERENT need floored — see module doc.
    return { ...pip, sulking: true };
  }

  // Idle / AssignedJob — enter Sulking now (spec §4.4), unchanged.
  return { ...pip, sulking: true, activity: PipActivity.Sulking };
}

/**
 * Automatic Rest wake (spec §5: "Pip auto-wakes at 100"): a Resting Pip
 * whose Energy has reached `autoWakeAtEnergy` wakes via `wake()` — which
 * resolves to Sulking rather than Idle if the Pip is still sulking (round
 * 2A). Run after every needs recompute; catch-up passes split segments at
 * restAutoWakeAt() so Energy is at exactly the threshold (never beyond)
 * at the wake moment.
 */
export function evaluateRestAutoWake(
  pip: PipState,
  tuning: MachineTuning = contentTuning,
): PipState {
  if (pip.activity !== PipActivity.Resting) return pip;
  if (pip.needs.energy < tuning.care.rest.autoWakeAtEnergy) return pip;
  const woken = wake(pip);
  // wake() only refuses when activity !== Resting, which the guard above
  // already excludes — this branch is unreachable but keeps the function
  // total without an unsafe cast.
  return woken.ok ? woken.pip : pip;
}

/**
 * The computable auto-wake moment (spec §4.5 rule 1: catch-up collects it
 * as a timed event): the absolute timestamp at which a Resting Pip's
 * Energy reaches `autoWakeAtEnergy`, i.e.
 * `needsUpdatedAt + (autoWakeAtEnergy − energy) / energyPerHour` hours.
 * `null` when the Pip is not Resting; already-due wakes (Energy at or past
 * the threshold) return `needsUpdatedAt`.
 *
 * `restSpeedMultiplier` (round 2F, progression bible §3.2): the Keep's
 * resolved building rest-speed multiplier (`core/keep/effects.ts`'s
 * `resolveKeepEffects().restSpeedMultiplier`) — defaults to 1 (no effect),
 * so every existing caller/fixture is unaffected. `core/pips/catchup.ts`'s
 * own wake-candidate loop re-derives this same arithmetic inline rather
 * than calling this function (a perf/clarity choice predating this round);
 * this export stays consistent with it for any other caller (a future
 * "ready in Xm" UI countdown) that predicts the same moment.
 */
export function restAutoWakeAt(
  pip: PipState,
  tuning: MachineTuning = contentTuning,
  restSpeedMultiplier = 1,
): number | null {
  if (pip.activity !== PipActivity.Resting) return null;
  const { energyPerHour, autoWakeAtEnergy } = tuning.care.rest;
  const effectiveEnergyPerHour = energyPerHour * restSpeedMultiplier;
  const deficit = autoWakeAtEnergy - pip.needs.energy;
  if (deficit <= 0) return pip.needsUpdatedAt;
  return pip.needsUpdatedAt + (deficit / effectiveEnergyPerHour) * HOUR_MS;
}

/**
 * Care actions (Feed/Clean/Play/Pet/Rest/Give Item) are legal only in
 * Idle, Resting, Sulking — not while away (spec §4.7). Sulking is
 * deliberately included: recovery is always one good care session away
 * (spec §4.4) — round 2A made this true for Rest too: `beginRest` now
 * accepts `Idle | Sulking` (previously Idle-only, which soft-locked a Pip
 * that Sulked at 0 Energy, since Rest is the only source of Energy). Every
 * OTHER care action already gated on this list alone with no extra
 * activity check, so this was the one actual bug — audited exhaustively
 * in machine.test.ts / care.test.ts.
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

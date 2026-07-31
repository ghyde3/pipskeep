/**
 * AILMENTS + THE LOSS PATH (spec §16 v1.5, docs/lifecycle-bible.md §3–§5,
 * §7). This is what makes Pips finite while keeping every one of the FIVE
 * PROMISES true by construction rather than by convention:
 *
 * 1. LOSS IS NEVER A SURPRISE. Danger arrives ONLY as an ailment with a
 *    visible countdown (`contractAilment`/`rollContraction` below): there
 *    is no code path anywhere in this repo that removes a Pip on an
 *    expedition return, or for any reason OTHER than this file's own
 *    `resolveAilments`. `minDurationMs (36h) > offlineRateCapMs (16h)` (an
 *    invariant asserted directly in `ailment.test.ts`) means a Pip who was
 *    HEALTHY when the app closed can never be worse than "worsening" when
 *    it reopens.
 * 2. LOSS IS NEVER CAUSED BY ABSENCE. The countdown is stored as
 *    `remainingMs` — a REMAINING duration, never an end timestamp — so it
 *    is a RATE, and `core/pips/needs.ts`'s `applyNeedsDelta` decrements it
 *    through the exact same rated/frozen split that already caps need
 *    decay (§4.5). `resolveAilments` (the ONLY function that may ever
 *    remove a Pip) is called SOLELY from `core/state.ts`'s live TICK arm —
 *    never from CATCHUP. A catch-up pass can advance a countdown; it can
 *    never end one.
 * 3. OLD AGE IS PEACEFUL. Untouched by this file — `core/pips/lifecycle.ts`
 *    owns that promise entirely; ailments are ORTHOGONAL to age (a Pip can
 *    be both ailing and Elder).
 * 4. EVERY LOSS LEAVES A THREAD TO PULL. A true loss writes a
 *    `LineageEggSeed` into the caller's `lineageEggs` in the SAME
 *    transition that removes the Pip (`resolveAilments`'s "TRUE LOSS"
 *    branch) — the two are one atomic step, so a loss without a seed is
 *    unrepresentable. The shape is defined here for the lineage/breeding
 *    system to consume (find-on-trip-return, hatch, inheritance) — this
 *    file only ever APPENDS a seed; it never reads or removes one.
 * 5. THE KEEP IS NEVER EMPTY. `resolveAilments` checks
 *    `tuning.retention.sanctuary.minActivePips` before it may EVER resolve
 *    a countdown as a true loss — the identical number
 *    `core/sanctuary/index.ts`'s `retireRefusal` already gates retirement
 *    on. If losing this Pip would take the roster below that floor, the
 *    countdown resolves as THE LOYAL TURN instead: survival, a scar, the
 *    same XP a real cure pays. This binds regardless of every other
 *    shield, so it is checked first.
 *
 * THE ALBUM IS PERMANENT: this file never touches `state.pipdex` and never
 * deletes a `PipState` — a lost Pip's whole record moves, verbatim, into
 * `state.sanctuary` (reason `"lost"`), which is where the Album's
 * `formsCaught`/`firstPortrait` data already lives independently of the
 * roster. Losing a Pip cannot regress an Album entry because nothing here
 * ever writes to one.
 *
 * Pure functions only, same discipline as every sibling module in this
 * directory: no clock access (`at` comes from the caller), no
 * `Math.random()` (an `RngStream` is threaded in, its cursor lives in
 * `GameState.rngState`). ZERO tuning literals — every number is read from
 * the tuning object (defaults to `content/tuning.ts`, injectable for
 * tests).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { PipActivity } from "./types";
import type { AilmentState, PipId, PipState, TraitGenome } from "./types";
import type { RngStream } from "../rng";
import {
  ailmentSurvivedPipXp,
  awardPipXp,
  contractReductionFor,
  countdownExtendMultiplierFor,
  cureBonusFor,
  pipLevel,
} from "./level";
import type { SanctuaryRecord, SanctuaryState } from "../sanctuary/types";

/** Named RNG stream for contraction + cure rolls (bible §9.2: "New RNG
 * streams: `ailment` (contract + cure)"). Cursor lives in `GameState`. */
export const AILMENT_STREAM = "ailment";

// ---------------------------------------------------------------------------
// CONTENT VIEW — structural, so core never imports content/ailments.ts
// directly (spec §2 rule 5: core treats content ids as opaque strings).
// ---------------------------------------------------------------------------

/** One ailment's content-defined shape, as core needs it. */
export interface AilmentDefView {
  readonly id: string;
  /** The ONE biome whose deep trip can inflict this ailment (bible §3.2). */
  readonly fromExpeditionId: string;
  readonly totalMs: number;
  readonly contractChance: number;
}

export type AilmentRegistry = Readonly<Record<string, AilmentDefView>>;

/** The tuning slice this file reads. `content/tuning.ts` satisfies it in
 * full. `lifecycle.level` mirrors the (fully optional/chained) shape
 * `pips/level.ts`'s `LevelEffectsTuning` declares, so
 * `contractReductionFor`/`countdownExtendMultiplierFor`/`cureBonusFor` can
 * be called with this SAME tuning object — a fixture that omits
 * `lifecycle.level` entirely still gets the correct identity (0
 * reduction, ×1 countdown, +0 cure bonus) from those getters. */
export interface AilmentTuning {
  readonly lifecycle: {
    readonly level?: {
      readonly contractReduction?: readonly number[];
      readonly countdownExtend?: readonly number[];
      readonly cureBonus?: readonly number[];
    };
    readonly ailments: {
      /** ⚠️ MUST exceed `offlineRateCapMs` — asserted directly in tests
       * (bible §3.3 rule 1: promise 1's mechanism). */
      readonly minDurationMs: number;
      /** Within a CATCH-UP pass only, `remainingMs` may never be reduced
       * below this (bible §3.3 rule 2 — the vigil floor). Live time has
       * no floor. */
      readonly vigilFloorMs: number;
      /** Stage boundaries as a fraction of `remainingMs / totalMs`:
       * `>= settling` → settling, `>= worsening` → worsening, else grave. */
      readonly stages: { readonly settling: number; readonly worsening: number };
      readonly poulticeCureChance: number;
      readonly devotedCareCureChance: number;
      readonly devotedCareNeedFloor: number;
      readonly cureEscalationPerAttempt: number;
      readonly cureBonusMax: number;
      readonly contractReductionMax: number;
      readonly inheritedResistance: number;
    };
    readonly shields: {
      readonly noLossBeforeLifeMs: number;
      readonly firstLossGrace: boolean;
    };
  };
  readonly offlineRateCapMs: number;
  readonly retention: {
    readonly sanctuary: {
      readonly minActivePips: number;
    };
  };
}

// ---------------------------------------------------------------------------
// STAGE (derived, never stored — bible §3.1)
// ---------------------------------------------------------------------------

export type AilmentStage = "settling" | "worsening" | "grave";

/** `remainingMs / totalMs` banded into a stage. Retuning the bands
 * re-grades every ailing Pip with no migration (the same discipline
 * `core/progression/mastery.ts`'s tier tables and `pipSeason` use). */
export function ailmentStage(
  ailment: AilmentState,
  tuning: AilmentTuning = contentTuning,
): AilmentStage {
  const fraction = ailment.totalMs > 0 ? ailment.remainingMs / ailment.totalMs : 0;
  const { settling, worsening } = tuning.lifecycle.ailments.stages;
  if (fraction >= settling) return "settling";
  if (fraction >= worsening) return "worsening";
  return "grave";
}

// ---------------------------------------------------------------------------
// CONTRACTION (bible §3.2) — the ONLY way a healthy Pip becomes an ailing
// one. Rolled at expedition-RETURN settle time (`core/expeditions/index.ts`'s
// `settleExpeditionReturn`), from the SAME moment loot is rolled — both live
// and catch-up returns go through that one function, so contraction is
// identical either way.
// ---------------------------------------------------------------------------

/** The registry entry (if any) whose `fromExpeditionId` matches — a safe
 * (quick) trip or an unknown biome resolves to `undefined`. */
export function ailmentForExpedition(
  registry: AilmentRegistry,
  expeditionId: string,
): AilmentDefView | undefined {
  return Object.values(registry).find((def) => def.fromExpeditionId === expeditionId);
}

/**
 * Roll whether a Pip returning from `expeditionId` contracts that biome's
 * ailment. Pure; consumes exactly ONE roll from `stream` whenever a roll is
 * actually possible (deterministic given the seed — `ailment.test.ts`
 * pins this), and ZERO rolls when:
 *
 * - the biome carries no ailment at all (every quick trip, by construction
 *   — `ailmentForExpedition` finds nothing);
 * - the Pip already carries an active ailment (one at a time);
 * - the Pip already carries a SCAR for this exact ailment (bible §3.6: a
 *   scar is a permanent immunity — the roll is skipped entirely, so the
 *   RNG stream stays honest for everyone else).
 *
 * `buildingContractReduction` mirrors `lifecycle.ts`'s `lifespanMs`
 * `buildingLongevity` parameter exactly: a seam for a future `remedy`
 * BuildingEffect channel (bible §3.5's Poultice Shelf/Wash Basin), not
 * wired to any caller this round — omitted (`0`) is exactly an unbuilt
 * Keep's true value.
 */
export function rollContraction(
  pip: PipState,
  expeditionId: string,
  stream: RngStream,
  registry: AilmentRegistry,
  at: number,
  tuning: AilmentTuning = contentTuning,
  buildingContractReduction = 0,
): AilmentState | null {
  if (pip.ailment != null) return null;
  const def = ailmentForExpedition(registry, expeditionId);
  if (def === undefined) return null;
  if (pip.scars?.includes(def.id) === true) return null;

  const levelReduction = contractReductionFor(pip, tuning);
  const reduction = Math.min(
    levelReduction + Math.max(0, buildingContractReduction),
    tuning.lifecycle.ailments.contractReductionMax,
  );
  const resistance = Math.max(0, Math.min(1, pip.resistances?.[def.id] ?? 0));
  const chance = Math.max(0, def.contractChance * (1 - reduction) * (1 - resistance));

  if (!stream.chance(chance)) return null;

  const totalMs = def.totalMs * countdownExtendMultiplierFor(pip, tuning);
  return {
    id: def.id,
    contractedAt: at,
    fromExpeditionId: expeditionId,
    remainingMs: totalMs,
    totalMs,
    cureAttempts: 0,
  };
}

// ---------------------------------------------------------------------------
// THE VIGIL FLOOR (bible §3.3 rule 2) — a CATCH-UP-ONLY clamp. Live time has
// no floor; this is deliberately NOT part of `needs.ts`'s per-segment
// decrement (which has no notion of "am I inside a catch-up pass"), and is
// instead applied ONCE, after a whole `runCatchup` pass, comparing the
// roster's ailments before vs after.
// ---------------------------------------------------------------------------

/**
 * Clamp every ailing Pip's post-catch-up `remainingMs` up to
 * `min(remainingMs BEFORE the absence, vigilFloorMs)`.
 *
 * ⚠️ THE CLAMP IS UNCONDITIONAL, and that is the whole point (the round-2H
 * cruelty audit's second blocker). An earlier cut only clamped when the
 * Pip started the absence at or above the floor, which turned the floor
 * into a CLIFF: a player who closed the app at 3h59m came back to 0h and
 * lost the Pip on the first live tick, while one who closed at 4h01m came
 * back to a full four hours. The 3h59m was consumed BY THE ABSENCE, which
 * is exactly what promise 2 forbids.
 *
 * The rule, stated as the two cases it covers:
 *
 * - ABOVE the floor when the app closed (say 5h) → returns at exactly the
 *   floor (4h). The absence may take time, never the last four hours.
 * - BELOW the floor when the app closed (say 0h30m) → returns at 0h30m,
 *   UNTOUCHED. The absence takes nothing at all, because there was
 *   nothing above the floor left for it to take.
 *
 * Either way `min(before, floor)` is a LOWER bound only — a pass that
 * somehow reduced nothing (or a Pip who was cured mid-pass) is never
 * pushed backwards, since the result is `max(after, bound)`.
 */
export function applyVigilFloor(
  pipsBefore: Readonly<Record<PipId, PipState>>,
  pipsAfter: Readonly<Record<PipId, PipState>>,
  tuning: AilmentTuning = contentTuning,
): Readonly<Record<PipId, PipState>> {
  const floor = tuning.lifecycle.ailments.vigilFloorMs;
  let result = pipsAfter;
  for (const [id, after] of Object.entries(pipsAfter)) {
    const before = pipsBefore[id];
    if (before === undefined || before.ailment == null || after.ailment == null) {
      continue;
    }
    const bound = Math.min(before.ailment.remainingMs, floor);
    if (after.ailment.remainingMs < bound) {
      result = {
        ...result,
        [id]: { ...after, ailment: { ...after.ailment, remainingMs: bound } },
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CURES (bible §3.5) — two routes, same odds formula: `base(route) +
// min(escalation + level, cureBonusMax)`. No cooldown gate; the limiter is
// items (POULTICE, via GIVE_ITEM) and the day boundary (DEVOTED CARE, via
// `applyDevotedCare` below, called from `core/state.ts`'s live TICK arm).
//
// BOTH ROUTES ARE WIRED. This is load-bearing, not housekeeping: the
// poultice route alone makes survival a function of INVENTORY rather than
// of care, and a player holding no poultice has no actionable chance at
// all — which breaks promise 1 outright. Devoted care is the route that
// belongs to every player, on every save, with an empty satchel.
// ---------------------------------------------------------------------------

export type CureRoute = "poultice" | "devotedCare";

export interface CureAttemptResult {
  readonly pip: PipState;
  readonly cured: boolean;
  readonly ailmentId: string;
}

/**
 * One cure roll against the Pip's CURRENT ailment. `null` if it is not
 * ailing (defensive — callers should already have checked). Consumes
 * exactly one roll from `stream` (deterministic given the seed).
 *
 * On success: the ailment clears, a SCAR for it is added (deduplicated —
 * a Pip can only ever hold one scar per ailment id), and
 * `ailmentSurvivedPipXp` is awarded directly (the same "this function IS
 * the qualifying moment" reasoning `lifecycle.ts`'s `applyEvolution` gives
 * for `evolvePipXp` — cure success has no other sole call site to hang the
 * award off).
 *
 * On failure: `cureAttempts` increments (bible's escalating-pity shape,
 * the same discipline `retention.eggPity` already ships) and nothing else
 * about the Pip changes.
 */
export function attemptCure(
  pip: PipState,
  route: CureRoute,
  stream: RngStream,
  tuning: AilmentTuning = contentTuning,
  /**
   * ROUND 2J FIX STAGE — the Keep's already-resolved, already-clamped
   * `remedy` cure bonus (`core/keep/effects.ts`'s
   * `resolveKeepEffects().ailmentCureBonus`). It enters the SAME summed,
   * `cureBonusMax`-clamped modifier the escalation and the Pip's own level
   * already share — never a second channel, so the shipped ceiling
   * (`cureBonusMax` 0.45) still binds and 2H's I4 holds: the Poultice's
   * base chance is untouched at 0.55.
   *
   * Omitted (`0`) is exactly an unbuilt Keep's true value, which is what
   * keeps every pre-2J fixture and every direct unit call byte-identical.
   */
  buildingCureBonus = 0,
): CureAttemptResult | null {
  const ailment = pip.ailment;
  if (ailment == null) return null;

  const cfg = tuning.lifecycle.ailments;
  const base = route === "poultice" ? cfg.poulticeCureChance : cfg.devotedCareCureChance;
  const escalation = cfg.cureEscalationPerAttempt * ailment.cureAttempts;
  const levelBonus = cureBonusFor(pip, tuning);
  const modifier = Math.min(
    escalation + levelBonus + Math.max(0, buildingCureBonus),
    cfg.cureBonusMax,
  );
  const chance = Math.min(1, Math.max(0, base + modifier));

  if (!stream.chance(chance)) {
    return {
      pip: { ...pip, ailment: { ...ailment, cureAttempts: ailment.cureAttempts + 1 } },
      cured: false,
      ailmentId: ailment.id,
    };
  }

  const scars =
    pip.scars?.includes(ailment.id) === true ? pip.scars : [...(pip.scars ?? []), ailment.id];
  // The XP AWARD deliberately reads `content/tuning.ts` directly rather
  // than the injected `tuning: AilmentTuning` — `AilmentTuning.lifecycle
  // .level` is intentionally a SLIM, fully-optional slice (only the three
  // ailment-effect tables), not the full `LevelXpTuning`/`LevelCurveTuning`
  // shape `awardPipXp`/`ailmentSurvivedPipXp` require. The injectable
  // `tuning` parameter controls every AILMENT-specific number (cure odds,
  // countdown length, contract chance); the Pip-XP curve itself is the
  // one global ladder every source in `pips/level.ts` already awards
  // against unconditionally.
  const curedPip = awardPipXp(
    { ...pip, ailment: null, scars },
    ailmentSurvivedPipXp(contentTuning),
    contentTuning,
  );
  return { pip: curedPip, cured: true, ailmentId: ailment.id };
}

// ---------------------------------------------------------------------------
// DEVOTED CARE (bible §3.5) — THE FREE ROUTE, and the one every player
// always has. One roll per ailing Pip per DAY INDEX, earned by holding all
// four needs at or above `devotedCareNeedFloor` — nothing to buy, nothing
// to find, nothing to have thought of in advance.
// ---------------------------------------------------------------------------

/**
 * Roll the free daily cure for every ailing Pip whose needs currently
 * clear `devotedCareNeedFloor` and who has not already had this day's
 * roll (`ailment.lastCareRollDay !== dayIndex`; `undefined` — a freshly
 * contracted ailment — is eligible immediately, which is deliberate: the
 * player's first chance to act must not be a day away).
 *
 * THE ROLL IS NEVER CONSUMED BY A DAY THE PLAYER DID NOT EARN. The stamp
 * is written only when a roll actually happens, so a day whose needs never
 * came up to the floor simply passes without spending anything — the day
 * index is a RATE LIMIT on the reward, never a deadline on the player.
 *
 * Consumes exactly one roll from `stream` per Pip actually rolled, in
 * `rosterOrder` (deterministic). A cure clears the ailment, adds the scar
 * and awards `ailmentSurvivedPipXp` inside `attemptCure`, exactly as the
 * poultice route does, and stamps `lastLossOutcome` so the caller's Keep-XP
 * pass grants `ailmentCured` generically.
 *
 * Callers should skip this entirely (and never open the stream) when
 * `devotedCareEligible` finds nobody — see `core/state.ts`'s TICK arm for
 * the zero-footprint pre-check.
 */
export function devotedCareEligible(
  state: Pick<AilmentHostState, "pips" | "rosterOrder">,
  dayIndex: number,
  tuning: AilmentTuning = contentTuning,
): readonly PipId[] {
  const floor = tuning.lifecycle.ailments.devotedCareNeedFloor;
  const out: PipId[] = [];
  for (const pipId of state.rosterOrder) {
    const pip = state.pips[pipId];
    if (pip === undefined || pip.ailment == null) continue;
    if (pip.ailment.lastCareRollDay === dayIndex) continue;
    if (!Object.values(pip.needs).every((n) => n >= floor)) continue;
    out.push(pipId);
  }
  return out;
}

export function applyDevotedCare<S extends AilmentHostState>(
  state: S,
  at: number,
  dayIndex: number,
  stream: RngStream,
  tuning: AilmentTuning = contentTuning,
  /** ROUND 2J FIX STAGE — passed straight through to `attemptCure`; see
   * its own doc. The free daily route benefits from a Poultice Shelf
   * exactly as much as a jar does, which is the point of a shelf. */
  buildingCureBonus = 0,
): S {
  let current: S = state;
  for (const pipId of devotedCareEligible(state, dayIndex, tuning)) {
    const pip = current.pips[pipId];
    if (pip === undefined || pip.ailment == null) continue;
    const ailmentId = pip.ailment.id;
    const result = attemptCure(pip, "devotedCare", stream, tuning, buildingCureBonus);
    if (result === null) continue;
    // Stamp the day on whatever ailment survived the attempt (a cure
    // clears it outright, so there is nothing left to stamp).
    const stamped: PipState =
      result.pip.ailment == null
        ? result.pip
        : { ...result.pip, ailment: { ...result.pip.ailment, lastCareRollDay: dayIndex } };
    current = {
      ...current,
      pips: { ...current.pips, [pipId]: stamped },
      ...(result.cured
        ? {
            lastLossOutcome: {
              kind: "cured" as const,
              pipId,
              at,
              ailmentId,
              route: "devotedCare" as const,
            },
          }
        : {}),
    };
  }
  return current;
}

// ---------------------------------------------------------------------------
// THE LOSS PATH — LineageEggSeed (promise 4), the loss outcome echo, and
// `resolveAilments`, the ONE function in this entire codebase allowed to
// remove a Pip. Called EXCLUSIVELY from `core/state.ts`'s live TICK arm.
// ---------------------------------------------------------------------------

/**
 * PROMISE 4's shape (bible §5.1) — a thread the lineage/breeding system
 * pulls: found on a later trip to `expeditionId`, hatched into a
 * descendant that inherits `genome` (the parent's BIRTH species — evolved
 * forms are never inherited, v1.3's standing rule), a share of `level`,
 * and `scars` as heritable resistances. This file only ever APPENDS one
 * (in the same transition that removes the Pip — a loss without a seed is
 * unrepresentable); it never reads, mutates or removes one. `misses`
 * starts at 0 and is the finder system's own forward-only counter to
 * increment on a completed trip to `expeditionId` that does not find it.
 */
export interface LineageEggSeed {
  readonly pipId: PipId;
  readonly name: string;
  readonly genome: TraitGenome;
  readonly expeditionId: string;
  readonly level: number;
  readonly scars: readonly string[];
  readonly generation: number;
  readonly seededAt: number;
  readonly misses: number;
}

/** What the most recent ailment resolution did — the UI's loss-moment /
 * Loyal-Turn / cure-witnessed data source, parked like every other
 * `last*Outcome` echo in `core/state.ts`. */
export type LossOutcome =
  | {
      readonly kind: "cured";
      readonly pipId: PipId;
      readonly at: number;
      readonly ailmentId: string;
      readonly route: CureRoute;
    }
  | {
      readonly kind: "loyalTurn";
      readonly pipId: PipId;
      readonly at: number;
      readonly ailmentId: string;
    }
  | {
      readonly kind: "lost";
      readonly pipId: PipId;
      readonly at: number;
      readonly ailmentId: string;
      readonly fromExpeditionId: string;
    };

/** Idempotence key for shield 4 — "the first time in a save's life that an
 * ailment would take a Pip, it doesn't" (bible §7.4). Once ever, per save,
 * never refilled. */
export const AILMENT_GRACE_COUNTER_KEY = "ailment.graceUsed";

/**
 * The minimal state shape `resolveAilments` operates on — structural (like
 * `SanctuaryHostState`/`CatchupState`) so this module never imports
 * `core/state.ts`; `GameState` satisfies it.
 */
export interface AilmentHostState {
  readonly pips: Readonly<Record<PipId, PipState>>;
  readonly rosterOrder: readonly PipId[];
  readonly activePipId: PipId;
  readonly sanctuary: SanctuaryState;
  /** Optional, `undefined ≡ []` — mirrors `GameState.lineageEggs`'s own
   * optional contract exactly, so every pre-2H `GameState` fixture across
   * the codebase satisfies this structural interface with no edits. */
  readonly lineageEggs?: readonly LineageEggSeed[];
  readonly counters: Readonly<Record<string, number>>;
  /** Optional, `undefined ≡ null` — mirrors `GameState.lastLossOutcome`. */
  readonly lastLossOutcome?: LossOutcome | null;
  readonly keep: { readonly level: number };
  /** Optional, `undefined ≡ all defaults` — mirrors `GameState.settings`.
   * `quietKeep` is shield zero (see `resolveAilments`). */
  readonly settings?: { readonly quietKeep?: boolean };
}

/**
 * Resolve every Pip whose ailment countdown has run out (`remainingMs <=
 * 0`). Call ONLY from the live TICK arm (never CATCHUP — promise 1/2's
 * mechanism: "the lost transition exists only in the live TICK arm").
 *
 * A Pip OnExpedition/Returning is skipped entirely (deferred until it
 * lands) — never taken mid-trip, the same tone `pendingSulk` already
 * protects (§4.4).
 *
 * THE SHIELDS, checked in this order (bible §7 — any one firing produces
 * THE LOYAL TURN: the ailment clears exactly like a real cure, scar and
 * XP included, and nothing announces that a safety net exists):
 *
 * 0. THE QUIET KEEP (`settings.quietKeep`, bible §7.7) — the player has
 *    said, in the Nook, that Pips in this Keep never fall ill. The setting
 *    already stops contraction at the source and clears anything in flight
 *    the moment it is switched on; this check is the belt to that braces,
 *    so that no ordering of events anywhere in the codebase can produce a
 *    loss in a Keep whose owner opted out of mortality.
 * 1. Promise 5 — losing this Pip would take the roster to (or below)
 *    `retention.sanctuary.minActivePips`. Checked against the LIVE roster
 *    size as pips are resolved one at a time within this same call, so it
 *    holds even in the extreme edge case of two countdowns ending on the
 *    same tick.
 * 2. The young cannot be lost — `lifeMs < shields.noLossBeforeLifeMs`
 *    (bible §7.3: three days). Shielded Pips can still CONTRACT ailments
 *    on purpose; only the ending is protected.
 * 3. The first-ever grace (bible §7.4) — `counters[AILMENT_GRACE_COUNTER_KEY]`
 *    not yet spent. ⚠️ SPENT ONLY WHEN IT IS THE SHIELD THAT ACTUALLY
 *    FIRED (`!isLastActive && !isYoung && !quiet`). An earlier cut keyed
 *    the spend on mere availability, so a Loyal Turn triggered by the
 *    young shield — i.e. one that could not have lost the Pip anyway —
 *    silently burned the once-per-save grace in week one, and it was gone
 *    by the time the player owned a Pip that was genuinely at risk. That
 *    is the exact opposite of "no player will ever lose their first Pip".
 *
 * Otherwise: TRUE LOSS. The Pip moves WHOLESALE out of `pips`/`rosterOrder`
 * into `sanctuary` under `reason: "lost"` (the SAME one-place invariant
 * `core/sanctuary/index.ts`'s retire/retrieve already keep — the Long
 * Meadow is reused wholesale, never a second graveyard structure), and a
 * `LineageEggSeed` is appended in this SAME step (promise 4 — atomic by
 * construction).
 */
export function resolveAilments<S extends AilmentHostState>(
  state: S,
  at: number,
  tuning: AilmentTuning = contentTuning,
): S {
  let current: S = state;

  for (const pipId of state.rosterOrder) {
    const pip = current.pips[pipId];
    if (pip === undefined || pip.ailment == null) continue;
    if (pip.ailment.remainingMs > 0) continue;
    if (
      pip.activity === PipActivity.OnExpedition ||
      pip.activity === PipActivity.Returning
    ) {
      continue;
    }

    const ailmentId = pip.ailment.id;
    const fromExpeditionId = pip.ailment.fromExpeditionId;

    const quiet = current.settings?.quietKeep === true;
    const isLastActive =
      current.rosterOrder.length <= tuning.retention.sanctuary.minActivePips;
    const isYoung = (pip.lifeMs ?? 0) < tuning.lifecycle.shields.noLossBeforeLifeMs;
    const graceAvailable =
      tuning.lifecycle.shields.firstLossGrace === true &&
      (current.counters[AILMENT_GRACE_COUNTER_KEY] ?? 0) < 1;
    // The grace is spent ONLY when it is the shield doing the work — see
    // the doc comment's shield 3. Every other shield is free and unlimited.
    const graceFires = graceAvailable && !quiet && !isLastActive && !isYoung;

    if (quiet || isLastActive || isYoung || graceAvailable) {
      const scars =
        pip.scars?.includes(ailmentId) === true ? pip.scars : [...(pip.scars ?? []), ailmentId];
      // Same reasoning as `attemptCure`'s identical line: the Pip-XP curve
      // reads `content/tuning.ts` directly, independent of the injected
      // (deliberately slim) `AilmentTuning`.
      const survived = awardPipXp(
        { ...pip, ailment: null, scars },
        ailmentSurvivedPipXp(contentTuning),
        contentTuning,
      );
      current = {
        ...current,
        pips: { ...current.pips, [pipId]: survived },
        counters: graceFires
          ? { ...current.counters, [AILMENT_GRACE_COUNTER_KEY]: 1 }
          : current.counters,
        lastLossOutcome: { kind: "loyalTurn", pipId, at, ailmentId },
      };
      continue;
    }

    // TRUE LOSS. The ONLY branch in this entire codebase that removes a
    // Pip from the active roster for a reason other than the player's own
    // RETIRE_PIP tap.
    const memorial: PipState = {
      ...pip,
      activity: PipActivity.Idle,
      pendingSulk: false,
      expedition: null,
    };
    const pips: Record<PipId, PipState> = { ...current.pips };
    delete pips[pipId];
    const rosterOrder = current.rosterOrder.filter((id) => id !== pipId);
    const activePipId =
      current.activePipId === pipId
        ? ((rosterOrder[0] as PipId | undefined) ?? current.activePipId)
        : current.activePipId;

    const record: SanctuaryRecord = {
      pip: memorial,
      retiredAt: at,
      retiredFromKeepLevel: current.keep.level,
      visits: 0,
      reason: "lost",
    };

    const lineageEgg: LineageEggSeed = {
      pipId,
      name: pip.name,
      genome: pip.genome,
      expeditionId: fromExpeditionId,
      level: pipLevel(pip),
      scars: pip.scars ?? [],
      // THE LOST PIP'S OWN GENERATION, never a literal. `breeding.ts`'s
      // `inheritFromLineageSeed` hatches the recovered descendant at
      // `seed.generation + 1`, so hardcoding 1 here would reset the whole
      // line to generation 2 on EVERY recovery and the "generations deep"
      // progression could never climb past it. `undefined ≡ 1` (original
      // stock), the same convention `PipState.generation` declares and
      // `combineForBreeding` reads.
      generation: pip.generation ?? 1,
      seededAt: at,
      misses: 0,
    };

    current = {
      ...current,
      pips,
      rosterOrder,
      activePipId,
      sanctuary: {
        pips: { ...current.sanctuary.pips, [pipId]: record },
        order: [...current.sanctuary.order, pipId],
      },
      lineageEggs: [...(current.lineageEggs ?? []), lineageEgg],
      lastLossOutcome: { kind: "lost", pipId, at, ailmentId, fromExpeditionId },
    };
  }

  return current;
}

/**
 * PER-PIP LEVELS (spec §16 v1.5, docs/lifecycle-bible.md §1).
 *
 * A second, smaller XP ladder that belongs to the PIP, not the Keep.
 * `GameState.keepXp` (round 2F, docs/progression-bible.md §0.1) remains
 * THE spine — no session is wasted, retiring a Pip still costs zero Keep
 * XP — this is a Pip's own biography: slower need decay, faster
 * expeditions, better ailment resilience, a longer life. The two numbers
 * are never shown in the same widget (bible §1.0).
 *
 * Pure calculators only, same division of labour as every sibling module
 * in this directory (`needs.ts`, `mood.ts`, `../progression/xp.ts`): "how
 * much does level N buy" and "how much XP does source X pay" live here;
 * "WHEN does an action qualify, and how do we never grant it twice" is
 * `core/state.ts`'s job (`applyPipXpForAction`, the single call site —
 * mirroring 2F's `applyKeepXpForAction` boundary), except for the ONE
 * source (`evolve`) whose qualifying moment already has a sole call site
 * of its own (`lifecycle.ts`'s `applyEvolution`), which awards it
 * directly rather than duplicating that gate here.
 *
 * ZERO tuning literals; every number is read from the tuning object
 * (defaults to `content/tuning.ts`, injectable for tests).
 *
 * TWO tuning shapes, on purpose:
 * - `LevelCurveTuning`/`LevelXpTuning` are REQUIRED-field slices (same
 *   convention as `progression/xp.ts`'s `KeepXpTuning`) — real content
 *   always has the whole `tuning.lifecycle.level` block, and every test
 *   that exercises these functions builds one deliberately.
 * - `LevelEffectsTuning` is FULLY OPTIONAL, chained all the way down
 *   (`tuning.lifecycle?.level?.seasoning`), because its readers
 *   (`core/pips/needs.ts`'s `effectiveRates`, `core/expeditions/index.ts`'s
 *   `effectiveExpeditionDurationMs`) are called by hundreds of pre-2H
 *   fixtures that build a bare tuning object with no `lifecycle` key at
 *   all — every getter below must be a strict no-op (return the
 *   untouched identity: 0 for a reduction, 1 for a multiplier) whenever
 *   the table is absent, so every one of those fixtures stays
 *   byte-identical (the same contract `expeditions/index.ts`'s existing
 *   `progression?.effectCaps?.expeditionSpeedFloorWithQuirk` already
 *   keeps).
 */

import { MINUTE_MS, tuning as contentTuning } from "../../content/tuning";
import type { PipState } from "./types";

/** The award table + curve (bible §1.1/§1.2), as core reads it. */
export interface LevelXpTuning {
  readonly lifecycle: {
    readonly level: {
      readonly xp: {
        readonly care: number;
        readonly tripBase: number;
        readonly tripPer5Min: number;
        readonly jobTick: number;
        readonly ailmentSurvived: number;
        readonly evolve: number;
        readonly masteryTierPerTier: number;
      };
    };
  };
}

/** The cumulative-XP curve (bible §1.2), as core reads it. */
export interface LevelCurveTuning {
  readonly lifecycle: {
    readonly level: {
      readonly maxLevel: number;
      /** Cumulative XP to REACH each level, index = level − 1. */
      readonly levelXp: readonly number[];
    };
  };
}

/**
 * What a level BUYS (bible §1.3) — every table optional and chained
 * (module doc): absent ≡ the untouched identity for that channel.
 */
export interface LevelEffectsTuning {
  readonly lifecycle?: {
    readonly level?: {
      /** Need-decay reduction fraction, SHARED with building comfort and
       * clamped together at `comfortReductionMax` (bible §1.4) — this
       * table alone is the UNCLAMPED per-level contribution. */
      readonly seasoning?: readonly number[];
      /** Expedition-duration multiplier (< 1 = faster). */
      readonly expeditionSpeed?: readonly number[];
      /** Ailment contract-chance reduction fraction (ailments' channel —
       * exported for that peer system to consume; not wired here). */
      readonly contractReduction?: readonly number[];
      /** Ailment countdown-length multiplier (> 1 = more time to react —
       * ailments' channel; not wired here). */
      readonly countdownExtend?: readonly number[];
      /** Cure-roll bonus fraction (ailments' channel; not wired here). */
      readonly cureBonus?: readonly number[];
      /** Lifespan multiplier bonus fraction (`lifecycle.ts`'s
       * `lifespanMs` reads this). */
      readonly lifespanBonus?: readonly number[];
    };
  };
}

/** Every migration needs to know which level a veteran is generously
 * granted, and what XP total that level implies (bible §9.2). */
export interface LevelMigrationTuning {
  readonly lifecycle: {
    readonly level: {
      readonly maxLevel: number;
      readonly levelXp: readonly number[];
      readonly migrationGrantLevel: number;
    };
  };
}

const FIVE_MIN_MS = 5 * MINUTE_MS;

/** A Pip's current level. `undefined ≡ 1` — the sulking/mastery
 * precedent (types.ts): every pre-2H fixture and save is level 1. */
export function pipLevel(pip: PipState): number {
  return pip.level ?? 1;
}

/** A Pip's current cumulative Pip XP. `undefined ≡ 0`. */
export function pipXpAmount(pip: PipState): number {
  return pip.pipXp ?? 0;
}

/** The highest level `xp` cumulative Pip XP reaches, capped at
 * `maxLevel`. `levelXp` is ascending with `levelXp[0] === 0`, so level 1
 * is always reachable — a newborn's 0 XP resolves to exactly level 1. */
export function levelForXp(
  xp: number,
  tuning: LevelCurveTuning = contentTuning,
): number {
  const { levelXp, maxLevel } = tuning.lifecycle.level;
  let level = 1;
  for (let i = 0; i < levelXp.length; i++) {
    if (xp >= (levelXp[i] as number)) level = i + 1;
    else break;
  }
  return Math.min(level, maxLevel);
}

/** The cumulative XP threshold for `level` (clamped to [1, maxLevel]) —
 * the migration's "a sane starting point" and the UI's "XP to next
 * level" both read this. */
export function xpForLevel(
  level: number,
  tuning: LevelCurveTuning = contentTuning,
): number {
  const { levelXp, maxLevel } = tuning.lifecycle.level;
  const idx = Math.min(Math.max(Math.trunc(level), 1), maxLevel) - 1;
  return (levelXp[idx] as number | undefined) ?? 0;
}

/**
 * Award `amount` Pip XP (never negative — a non-positive amount is a
 * pure no-op, returning `pip` BY REFERENCE so callers can cheaply detect
 * "nothing changed", the same convention `core/keep`'s refusal contract
 * and `core/progression`'s pure calculators already use) and recompute
 * `level` from the new total. Levels only ever go UP (`levelForXp` is
 * monotonic in `xp`, and `xp` itself only accumulates) — there is no
 * code path that lowers either field.
 */
export function awardPipXp(
  pip: PipState,
  amount: number,
  tuning: LevelCurveTuning = contentTuning,
): PipState {
  if (!(amount > 0)) return pip;
  const nextXp = pipXpAmount(pip) + amount;
  const nextLevel = levelForXp(nextXp, tuning);
  return { ...pip, pipXp: nextXp, level: nextLevel };
}

// ---------------------------------------------------------------------------
// XP SOURCES (bible §1.1) — one small pure function per award-table row,
// exactly `core/progression/xp.ts`'s pattern. "Refusals, TICK, selection,
// building, bounties, streaks, milestones" pay 0 by simply having no
// function here — there is nothing to call.
// ---------------------------------------------------------------------------

/** A care action applied to THIS Pip (FEED/CLEAN/PLAY/PET/GIVE_ITEM, or a
 * REST_TOGGLE that started a nap) — bible §1.1 row 1. */
export function careActionPipXp(tuning: LevelXpTuning = contentTuning): number {
  return tuning.lifecycle.level.xp.care;
}

/** A completed expedition, credited to the Pip that went (bible §1.1 row
 * 2): `tripBase + tripPer5Min × ⌊durationMs / 5min⌋`. */
export function tripPipXp(
  durationMs: number,
  tuning: LevelXpTuning = contentTuning,
): number {
  const cfg = tuning.lifecycle.level.xp;
  return cfg.tripBase + cfg.tripPer5Min * Math.floor(durationMs / FIVE_MIN_MS);
}

/** `ticks` produced job ticks while this Pip was the working one (bible
 * §1.1 row 3) — already bounded by `offlineRateCapMs`, same as Keep XP's
 * own `jobTickXp`. */
export function jobTickPipXp(
  ticks: number,
  tuning: LevelXpTuning = contentTuning,
): number {
  return tuning.lifecycle.level.xp.jobTick * Math.max(0, ticks);
}

/** Surviving an ailment, cured or via the Loyal Turn (bible §1.1 row 4).
 * Exported for the ailments peer system — its qualifying moment is not
 * this round's to wire. */
export function ailmentSurvivedPipXp(tuning: LevelXpTuning = contentTuning): number {
  return tuning.lifecycle.level.xp.ailmentSurvived;
}

/** This Pip's own evolution (bible §1.1 row 5) — awarded directly inside
 * `lifecycle.ts`'s `applyEvolution`, the sole call site for the
 * qualifying moment; exported so that is the only place doing the
 * arithmetic. */
export function evolvePipXp(tuning: LevelXpTuning = contentTuning): number {
  return tuning.lifecycle.level.xp.evolve;
}

/** A mastery tier gained ON THIS TRIP (bible §1.1 row 6):
 * `masteryTierPerTier × newTier`. */
export function masteryTierPipXp(
  newTier: number,
  tuning: LevelXpTuning = contentTuning,
): number {
  return tuning.lifecycle.level.xp.masteryTierPerTier * Math.max(0, newTier);
}

// ---------------------------------------------------------------------------
// LEVEL EFFECTS (bible §1.3) — one getter per channel, each a strict
// no-op (the channel's multiplicative/additive identity) at level 1 or
// when the table is absent from the injected tuning.
// ---------------------------------------------------------------------------

/** `table[level − 1]`, clamped to the table's own bounds; `identity` when
 * the table is absent or empty. The one shared lookup every getter below
 * uses, so every channel clamps the SAME way (a shorter/retuned table
 * never throws — it just holds its last entry, the same discipline
 * `core/progression/mastery.ts`'s tier tables use). */
function levelTableValue(
  table: readonly number[] | undefined,
  level: number,
  identity: number,
): number {
  if (table === undefined || table.length === 0) return identity;
  const idx = Math.min(Math.max(Math.trunc(level) - 1, 0), table.length - 1);
  return (table[idx] as number | undefined) ?? identity;
}

/** SHARED care-ease channel (bible §1.4) — the UNCLAMPED per-level
 * contribution; `core/pips/needs.ts`'s `effectiveRates` sums it with
 * building comfort and clamps ONCE at `comfortReductionMax`. `0` at
 * level 1 or when the table/tuning is absent. */
export function seasoningFor(
  pip: PipState,
  tuning: LevelEffectsTuning = contentTuning,
): number {
  return levelTableValue(tuning.lifecycle?.level?.seasoning, pipLevel(pip), 0);
}

/** Expedition-duration multiplier (`< 1` = faster). `1` at level 1 or
 * when absent — `core/expeditions/index.ts`'s
 * `effectiveExpeditionDurationMs` composes this with the Keep's building
 * speed and Hardworking's quirk, floored together. */
export function expeditionSpeedMultiplierFor(
  pip: PipState,
  tuning: LevelEffectsTuning = contentTuning,
): number {
  return levelTableValue(tuning.lifecycle?.level?.expeditionSpeed, pipLevel(pip), 1);
}

/** Ailment contract-chance reduction fraction. Exported for the ailments
 * peer system to sum into its own `contractReductionMax`-clamped channel
 * alongside buildings — NOT wired into any reducer this round. */
export function contractReductionFor(
  pip: PipState,
  tuning: LevelEffectsTuning = contentTuning,
): number {
  return levelTableValue(tuning.lifecycle?.level?.contractReduction, pipLevel(pip), 0);
}

/** Ailment countdown-length multiplier (`> 1` = more time to react).
 * Exported for the ailments peer system; not wired here. */
export function countdownExtendMultiplierFor(
  pip: PipState,
  tuning: LevelEffectsTuning = contentTuning,
): number {
  return levelTableValue(tuning.lifecycle?.level?.countdownExtend, pipLevel(pip), 1);
}

/** Cure-roll bonus fraction. Exported for the ailments peer system to sum
 * into its own `cureBonusMax`-clamped channel; not wired here. */
export function cureBonusFor(
  pip: PipState,
  tuning: LevelEffectsTuning = contentTuning,
): number {
  return levelTableValue(tuning.lifecycle?.level?.cureBonus, pipLevel(pip), 0);
}

/** Lifespan multiplier bonus fraction (bible §2.3) — `lifecycle.ts`'s
 * `lifespanMs` reads this directly. */
export function lifespanBonusFor(
  pip: PipState,
  tuning: LevelEffectsTuning = contentTuning,
): number {
  return levelTableValue(tuning.lifecycle?.level?.lifespanBonus, pipLevel(pip), 0);
}

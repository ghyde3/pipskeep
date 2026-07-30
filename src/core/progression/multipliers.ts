/**
 * LOOT MULTIPLIERS (docs/retention-bible.md §9) — ONE channel, summed once,
 * clamped once.
 *
 * Every source of "more loot" in the game (Curious's shipped
 * `quirks.curiousLootBonus`, expedition mastery, the streak tier, an
 * active event) is an ADDITIVE bonus-roll CHANCE. They are summed here and
 * the sum is clamped to `retention.loot.bonusRollChanceMax` — sum-then-
 * clamp, never multiply-then-clamp, for two reasons stated in the bible:
 * the player can read it ("+10% Curious, +15% mastery → capped at +25%"),
 * and nothing can compound.
 *
 * Egg chance is a SEPARATE channel (additive percentage POINTS from
 * mastery's top tier and events), clamped at `eggChanceBonusPointsMax`,
 * with `eggChanceCeiling` as a hard ceiling on the RESULTING chance so a
 * biome's base odds can never become a certainty.
 *
 * This module is pure arithmetic — it does not roll anything and does not
 * know about RNG streams. `core/expeditions/index.ts` is the single call
 * site that spends the resulting chance as a roll (see its module doc for
 * the cursor-parity contract this composition must preserve: a fresh save
 * with zero mastery/streak/event bonus must consume byte-identical rolls
 * to before this round, which holds here because `effectiveLootBonusChance`
 * of an all-zero `LootBonusSources` is exactly `curious ? curiousLootBonus
 * : 0` — the pre-round-2C formula, unchanged).
 */

export interface MultiplierTuning {
  readonly quirks: {
    readonly curiousLootBonus: number;
  };
  readonly retention: {
    readonly loot: {
      readonly bonusRollChanceMax: number;
      readonly eggChanceBonusPointsMax: number;
      readonly eggChanceCeiling: number;
    };
  };
}

/** Every source that can contribute to the ONE loot-bonus-chance channel. */
export interface LootBonusSources {
  /** Curious's shipped +10% (spec §4.2) — true iff this Pip is Curious. */
  readonly curious: boolean;
  /** This Pip's mastery-tier bonus-roll chance in the biome it is on
   * (`core/progression/mastery.ts` `masteryBonusRollChance`). */
  readonly masteryBonusChance: number;
  /** The player's current streak-tier bonus
   * (`core/progression/streak.ts` `streakLootBonus`). */
  readonly streakBonusChance: number;
  /** The active event's loot bonus, if any (0 when no event is running or
   * the active event grants none). */
  readonly eventBonusChance: number;
  /**
   * ROUND 2F (progression bible §3.1 rule 4) — a placed building's (a
   * Trail Post) or active themed set's (Deep Wood) additive loot-bonus
   * contribution (`core/keep/effects.ts`'s
   * `resolveKeepEffects().expeditionLootBonusChance`) enters this SAME
   * summed-then-clamped channel, never a second one — "a Trail Post's
   * +3% enters the same sum as Curious's +10%, mastery's +15% and the
   * streak tier's +20%". Optional, defaults to 0, so every pre-2F caller
   * (including every existing test building this object literal without
   * it) is unaffected.
   */
  readonly buildingBonusChance?: number;
}

export const NO_LOOT_BONUS: LootBonusSources = {
  curious: false,
  masteryBonusChance: 0,
  streakBonusChance: 0,
  eventBonusChance: 0,
};

/**
 * Sum every source, then clamp ONCE at `bonusRollChanceMax`. Applied at a
 * single site (`rollExpeditionLoot`) so the cap is never bypassed by a
 * caller composing sources differently.
 */
export function effectiveLootBonusChance(
  sources: LootBonusSources,
  tuning: MultiplierTuning,
): number {
  const curiousChance = sources.curious ? tuning.quirks.curiousLootBonus : 0;
  const sum =
    curiousChance +
    sources.masteryBonusChance +
    sources.streakBonusChance +
    sources.eventBonusChance +
    (sources.buildingBonusChance ?? 0);
  return Math.min(Math.max(sum, 0), tuning.retention.loot.bonusRollChanceMax);
}

/** Every source that can contribute to the egg-chance bonus-POINTS
 * channel (mastery's top tier, an active event). Separate from loot. */
export interface EggChanceBonusSources {
  readonly masteryPoints: number;
  readonly eventPoints: number;
  /** ROUND 2F — a placed building's (or active themed set's) additive
   * egg-chance-points contribution (`resolveKeepEffects().eggChanceBonusPoints`,
   * e.g. the Weathervane). Optional, defaults to 0; see
   * `LootBonusSources.buildingBonusChance`'s doc comment for why this is
   * the same channel-composition rule applied to the sibling channel. */
  readonly buildingPoints?: number;
}

export const NO_EGG_CHANCE_BONUS: EggChanceBonusSources = {
  masteryPoints: 0,
  eventPoints: 0,
};

/** Sum-then-clamp the egg-chance bonus POINTS (not a chance itself — added
 * to a biome's base egg chance by `applyEggChanceBonus`). */
export function effectiveEggChanceBonusPoints(
  sources: EggChanceBonusSources,
  tuning: MultiplierTuning,
): number {
  const sum = sources.masteryPoints + sources.eventPoints + (sources.buildingPoints ?? 0);
  return Math.min(
    Math.max(sum, 0),
    tuning.retention.loot.eggChanceBonusPointsMax,
  );
}

/** Apply the (already-clamped) egg-chance bonus points to a biome's base
 * chance, with a hard ceiling so the result can never reach certainty. */
export function applyEggChanceBonus(
  baseChance: number,
  bonusPoints: number,
  tuning: MultiplierTuning,
): number {
  return Math.min(baseChance + bonusPoints, tuning.retention.loot.eggChanceCeiling);
}

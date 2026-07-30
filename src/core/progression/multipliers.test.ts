import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import {
  NO_EGG_CHANCE_BONUS,
  NO_LOOT_BONUS,
  applyEggChanceBonus,
  effectiveEggChanceBonusPoints,
  effectiveLootBonusChance,
} from "./multipliers";

describe("effectiveLootBonusChance — sum then clamp, once", () => {
  it("is exactly 0 with no sources at all", () => {
    expect(effectiveLootBonusChance(NO_LOOT_BONUS, contentTuning)).toBe(0);
  });

  it("matches the pre-round-2C formula for a fresh save (curious only, everything else 0)", () => {
    const curiousOnly = { ...NO_LOOT_BONUS, curious: true };
    expect(effectiveLootBonusChance(curiousOnly, contentTuning)).toBeCloseTo(
      contentTuning.quirks.curiousLootBonus,
    );
  });

  it("sums additively below the cap", () => {
    const sources = {
      curious: false,
      masteryBonusChance: 0.05,
      streakBonusChance: 0.05,
      eventBonusChance: 0.02,
    };
    expect(effectiveLootBonusChance(sources, contentTuning)).toBeCloseTo(0.12);
  });

  it("holds the cap under MAXIMUM stacking (curious + top mastery + top streak + top event)", () => {
    const maxed = {
      curious: true, // +0.10
      masteryBonusChance: 0.15, // tier 5
      streakBonusChance: 0.2, // 30-day streak
      eventBonusChance: 0.1, // an event's max
    };
    const naiveSum =
      contentTuning.quirks.curiousLootBonus +
      maxed.masteryBonusChance +
      maxed.streakBonusChance +
      maxed.eventBonusChance;
    expect(naiveSum).toBeGreaterThan(contentTuning.retention.loot.bonusRollChanceMax);
    const effective = effectiveLootBonusChance(maxed, contentTuning);
    expect(effective).toBeLessThanOrEqual(contentTuning.retention.loot.bonusRollChanceMax);
    expect(effective).toBeCloseTo(contentTuning.retention.loot.bonusRollChanceMax);
  });

  it("never goes negative even from a hostile negative source", () => {
    const hostile = {
      curious: false,
      masteryBonusChance: -1,
      streakBonusChance: 0,
      eventBonusChance: 0,
    };
    expect(effectiveLootBonusChance(hostile, contentTuning)).toBe(0);
  });
});

describe("egg chance bonus — separate channel, separately capped", () => {
  it("is 0 with no sources", () => {
    expect(effectiveEggChanceBonusPoints(NO_EGG_CHANCE_BONUS, contentTuning)).toBe(0);
  });

  it("caps at eggChanceBonusPointsMax under max stacking", () => {
    const maxed = { masteryPoints: 0.02, eventPoints: 0.05 };
    const naive = maxed.masteryPoints + maxed.eventPoints;
    const effective = effectiveEggChanceBonusPoints(maxed, contentTuning);
    expect(effective).toBeLessThanOrEqual(
      contentTuning.retention.loot.eggChanceBonusPointsMax,
    );
    if (naive > contentTuning.retention.loot.eggChanceBonusPointsMax) {
      expect(effective).toBeCloseTo(contentTuning.retention.loot.eggChanceBonusPointsMax);
    }
  });

  it("applyEggChanceBonus never exceeds the hard ceiling, even at a high base chance", () => {
    const result = applyEggChanceBonus(0.99, 0.05, contentTuning);
    expect(result).toBeLessThanOrEqual(contentTuning.retention.loot.eggChanceCeiling);
  });

  it("a zero bonus never changes the base chance (fresh-save parity)", () => {
    expect(applyEggChanceBonus(0.5, 0, contentTuning)).toBe(0.5);
    expect(applyEggChanceBonus(0.08, 0, contentTuning)).toBe(0.08);
  });
});

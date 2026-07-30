/**
 * Keep-wide building effect aggregation (docs/progression-bible.md §3).
 * `resolveKeepEffects` is the pure derivation: placements + content → ONE
 * capped value per channel. This file covers:
 *
 * - the IDENTITY on an unbuilt Keep (the whole reason every wiring call
 *   site elsewhere can default to it and stay byte-identical, bible §8.2);
 * - real-content spot checks (the four shipped placeables actually sum the
 *   way bible §3.4 describes);
 * - every cap holding at maximum stacking, via SYNTHETIC content so the
 *   numbers are exact and independent of how much real content exists
 *   today (content/decorSets.ts's own doc explains why four of six sets
 *   cannot yet reach 5 real members);
 * - set-bonus counting (distinct placed member ids, never a raw placement
 *   count) and tier gating by BOTH member count and Keep level, with
 *   tier-2 REPLACING (never stacking with) tier-1.
 *
 * `core/keep/effects.balance.test.ts` covers the one claim this file
 * deliberately does NOT (the §3.6 "still needs real care" proof); the
 * wiring itself (that a resolved value actually reaches
 * `core/pips/needs.ts`/`core/expeditions/index.ts`/`core/eggs/index.ts`
 * through the real reducer) is `core/keep/effects.wiring.test.ts`'s job.
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import type { BuildingEffect } from "../../content/buildingEffects";
import type { DecorSetDef } from "../../content/decorSets";
import { placeables as contentPlaceables } from "../../content/placeables";
import { decorations as contentDecorations } from "../../content/decorations";
import { createKeep } from "./index";
import type { KeepState, Placement } from "./index";
import {
  IDENTITY_KEEP_EFFECTS,
  keepComfortMultipliers,
  resolveKeepEffects,
} from "./effects";
import type { EffectItemRegistryView, KeepEffectsContent } from "./effects";

const NEEDS = ["hunger", "cleanliness", "happiness", "energy"] as const;

function placementsOf(itemIds: readonly string[]): KeepState["placements"] {
  const placements: Record<string, Placement> = {};
  itemIds.forEach((itemId, i) => {
    placements[`place-${i}`] = { itemId, x: i, y: 0 };
  });
  return placements;
}

function keepWith(itemIds: readonly string[], level = 1): KeepState {
  return { level, placements: placementsOf(itemIds) };
}

describe("resolveKeepEffects — identity on an unbuilt Keep", () => {
  it("resolves to IDENTITY_KEEP_EFFECTS when nothing is placed", () => {
    expect(resolveKeepEffects(createKeep(), 1)).toEqual(IDENTITY_KEEP_EFFECTS);
  });

  it("keepComfortMultipliers of the identity is all-1.0", () => {
    expect(keepComfortMultipliers(IDENTITY_KEEP_EFFECTS)).toEqual({
      hunger: 1,
      cleanliness: 1,
      happiness: 1,
      energy: 1,
    });
  });
});

describe("resolveKeepEffects — real content spot checks (bible §3.4)", () => {
  it("the Food Bowl alone slows Hunger by exactly 6%", () => {
    const effects = resolveKeepEffects(keepWith(["food-bowl"]), 1);
    expect(effects.comfort.hunger).toBeCloseTo(0.06, 10);
    expect(effects.comfort.cleanliness).toBe(0);
  });

  it("Bowl + Stockpot sum Hunger comfort to 10% (both placed)", () => {
    const effects = resolveKeepEffects(keepWith(["food-bowl", "stockpot"]), 3);
    expect(effects.comfort.hunger).toBeCloseTo(0.1, 10);
  });

  it("the Bed alone gives ×1.25 rest speed and −6% Energy decay", () => {
    const effects = resolveKeepEffects(keepWith(["bed"]), 1);
    expect(effects.restSpeedMultiplier).toBeCloseTo(1.25, 10);
    expect(effects.comfort.energy).toBeCloseTo(0.06, 10);
  });

  it("the Gathering Station and Stockpot are both listed as hosted jobs", () => {
    const effects = resolveKeepEffects(keepWith(["gathering-station", "stockpot"]), 3);
    expect(new Set(effects.hostedJobIds)).toEqual(new Set(["gathering", "simmering"]));
  });

  it("an unknown itemId (stale content between sessions) contributes nothing and never throws", () => {
    const effects = resolveKeepEffects(keepWith(["not-a-real-item"]), 1);
    expect(effects).toEqual(IDENTITY_KEEP_EFFECTS);
  });
});

describe("resolveKeepEffects — every cap holds at maximum stacking (synthetic content)", () => {
  const fixtureItems: EffectItemRegistryView = {
    "comfort-a": { effects: [{ kind: "comfort", need: "hunger", decayReduction: 0.5 }] },
    "comfort-b": { effects: [{ kind: "comfort", need: "hunger", decayReduction: 0.5 }] },
    "comfort-all": { effects: [{ kind: "comfort", need: "all", decayReduction: 0.5 }] },
    "rest-a": { effects: [{ kind: "restSpeed", multiplier: 1.25 }] },
    "rest-b": { effects: [{ kind: "restSpeed", multiplier: 1.2 }] },
    "trip-a": { effects: [{ kind: "expeditionSpeed", multiplier: 0.92 }] },
    "trip-b": { effects: [{ kind: "expeditionSpeed", multiplier: 0.92 }] },
    "egg-a": { effects: [{ kind: "incubationSpeed", multiplier: 0.85 }] },
    "egg-b": { effects: [{ kind: "incubationSpeed", multiplier: 0.85 }] },
    "loot-a": { effects: [{ kind: "expeditionLoot", bonusRollChance: 0.5 }] },
    "loot-b": { effects: [{ kind: "expeditionLoot", bonusRollChance: 0.5 }] },
    "points-a": { effects: [{ kind: "eggChancePoints", points: 0.5 }] },
    "xp-a": { effects: [{ kind: "xpBonus", fraction: 0.5 }] },
    "xp-b": { effects: [{ kind: "xpBonus", fraction: 0.5 }] },
  };
  const content: KeepEffectsContent = { items: fixtureItems, sets: [] };

  it("comfort sums additively then clamps at effectCaps.comfortReductionMax", () => {
    const effects = resolveKeepEffects(keepWith(["comfort-a", "comfort-b"]), 1, content);
    // 0.5 + 0.5 = 1.0, clamped to 0.25.
    expect(effects.comfort.hunger).toBe(tuning.progression.effectCaps.comfortReductionMax);
  });

  it('a "all" comfort effect applies to every need', () => {
    const effects = resolveKeepEffects(keepWith(["comfort-all"]), 1, content);
    for (const need of NEEDS) {
      expect(effects.comfort[need]).toBeCloseTo(0.5 > tuning.progression.effectCaps.comfortReductionMax
        ? tuning.progression.effectCaps.comfortReductionMax
        : 0.5, 10);
    }
  });

  it("restSpeed multiplies (bible's own worked example: ×1.25 × ×1.20 = ×1.50, under 1.60)", () => {
    const effects = resolveKeepEffects(keepWith(["rest-a", "rest-b"]), 1, content);
    expect(effects.restSpeedMultiplier).toBeCloseTo(1.5, 10);
    expect(effects.restSpeedMultiplier).toBeLessThan(tuning.progression.effectCaps.restSpeedMax);
  });

  it("restSpeed clamps at effectCaps.restSpeedMax when the product would exceed it", () => {
    const effects = resolveKeepEffects(keepWith(["rest-a", "rest-a", "rest-b"]), 1, content);
    expect(effects.restSpeedMultiplier).toBe(tuning.progression.effectCaps.restSpeedMax);
  });

  it("expeditionSpeed multiplies (two ×0.92 buildings → ×0.8464, clamped to the 0.85 floor)", () => {
    const effects = resolveKeepEffects(keepWith(["trip-a", "trip-b"]), 1, content);
    expect(effects.expeditionSpeedMultiplier).toBe(tuning.progression.effectCaps.expeditionSpeedMin);
  });

  it("a single expeditionSpeed building is NOT clamped (0.92 is above the 0.85 floor)", () => {
    const effects = resolveKeepEffects(keepWith(["trip-a"]), 1, content);
    expect(effects.expeditionSpeedMultiplier).toBeCloseTo(0.92, 10);
  });

  it("incubationSpeed multiplies and clamps at the incubationSpeedMin floor", () => {
    const single = resolveKeepEffects(keepWith(["egg-a"]), 1, content);
    expect(single.incubationSpeedMultiplier).toBeCloseTo(0.85, 10);
    const double = resolveKeepEffects(keepWith(["egg-a", "egg-b"]), 1, content);
    // 0.85 * 0.85 = 0.7225, clamped up to the 0.80 floor.
    expect(double.incubationSpeedMultiplier).toBe(
      tuning.progression.effectCaps.incubationSpeedMin,
    );
  });

  it("expeditionLootBonusChance and eggChanceBonusPoints are summed but NOT clamped here (bible §3.3: no entry in effectCaps — the shared 2C channel clamps once, downstream)", () => {
    const effects = resolveKeepEffects(keepWith(["loot-a", "loot-b"]), 1, content);
    expect(effects.expeditionLootBonusChance).toBeCloseTo(1.0, 10);
    expect(effects.expeditionLootBonusChance).toBeGreaterThan(
      tuning.retention.loot.bonusRollChanceMax,
    );
    const points = resolveKeepEffects(keepWith(["points-a"]), 1, content);
    expect(points.eggChanceBonusPoints).toBeCloseTo(0.5, 10);
  });

  it("xpBonus sums additively then clamps at effectCaps.xpBonusMax", () => {
    const effects = resolveKeepEffects(keepWith(["xp-a", "xp-b"]), 1, content);
    expect(effects.xpBonusFraction).toBe(tuning.progression.effectCaps.xpBonusMax);
  });
});

describe("resolveKeepEffects — themed set bonuses (bible §3.5)", () => {
  const fixtureItems: EffectItemRegistryView = {
    "member-1": {},
    "member-2": {},
    "member-3": {},
    "member-4": {},
    "member-5": {},
  };
  const testSet: DecorSetDef = {
    id: "test-set",
    name: "Test Set",
    memberItemIds: ["member-1", "member-2", "member-3", "member-4", "member-5"],
    bonusAt3: { kind: "comfort", need: "happiness", decayReduction: 0.04 },
    bonusAt5: { kind: "comfort", need: "happiness", decayReduction: 0.07 },
  };
  const content: KeepEffectsContent = { items: fixtureItems, sets: [testSet] };

  it("no bonus below the tier-1 member threshold", () => {
    const effects = resolveKeepEffects(
      keepWith(["member-1", "member-2"], tuning.progression.setBonus.tier1LiveAtKeepLevel),
      tuning.progression.setBonus.tier1LiveAtKeepLevel,
      content,
    );
    expect(effects.comfort.happiness).toBe(0);
    expect(effects.activeSetBonuses).toEqual([]);
  });

  it("tier-1 bonus applies at exactly minMembersTier1 distinct members, once the tier is live", () => {
    const level = tuning.progression.setBonus.tier1LiveAtKeepLevel;
    const effects = resolveKeepEffects(
      keepWith(["member-1", "member-2", "member-3"], level),
      level,
      content,
    );
    expect(effects.comfort.happiness).toBeCloseTo(0.04, 10);
    expect(effects.activeSetBonuses).toEqual([
      { setId: "test-set", tier: 1, effect: testSet.bonusAt3 },
    ]);
  });

  it("the tier-1 bonus does NOT apply before the Keep reaches tier1LiveAtKeepLevel, even with enough members placed", () => {
    const level = tuning.progression.setBonus.tier1LiveAtKeepLevel - 1;
    const effects = resolveKeepEffects(
      keepWith(["member-1", "member-2", "member-3"], level),
      level,
      content,
    );
    expect(effects.comfort.happiness).toBe(0);
  });

  it("tier-2 REPLACES tier-1 at minMembersTier2 distinct members (never stacks)", () => {
    const level = tuning.progression.setBonus.tier2LiveAtKeepLevel;
    const effects = resolveKeepEffects(
      keepWith(["member-1", "member-2", "member-3", "member-4", "member-5"], level),
      level,
      content,
    );
    // If it stacked this would be 0.04 + 0.07 = 0.11 — it must be exactly 0.07.
    expect(effects.comfort.happiness).toBeCloseTo(0.07, 10);
    expect(effects.activeSetBonuses).toEqual([
      { setId: "test-set", tier: 2, effect: testSet.bonusAt5 },
    ]);
  });

  it("5 distinct members before tier2LiveAtKeepLevel still only grants the tier-1 bonus", () => {
    const level = tuning.progression.setBonus.tier1LiveAtKeepLevel;
    const effects = resolveKeepEffects(
      keepWith(["member-1", "member-2", "member-3", "member-4", "member-5"], level),
      level,
      content,
    );
    expect(effects.comfort.happiness).toBeCloseTo(0.04, 10);
  });

  it("counts DISTINCT member ids, never raw placement count (five of the SAME item is one member)", () => {
    const level = tuning.progression.setBonus.tier1LiveAtKeepLevel;
    const placements: Record<string, Placement> = {};
    for (let i = 0; i < 5; i++) placements[`place-${i}`] = { itemId: "member-1", x: i, y: 0 };
    const effects = resolveKeepEffects({ level, placements }, level, content);
    expect(effects.comfort.happiness).toBe(0);
  });
});

describe("resolveKeepEffects — real decorSets stay internally consistent against real decorations", () => {
  it("Meadow Green and Tideline (the two fully-5-member-shipped sets) reach their tier-2 bonus", () => {
    // Meadow Green: moss-tuft, pebble-path, berry-planter, toadstool-ring,
    // cloud-kite — all five ship today (content/decorSets.ts's own doc).
    const level = tuning.progression.setBonus.tier2LiveAtKeepLevel;
    const effects = resolveKeepEffects(
      keepWith(
        ["moss-tuft", "pebble-path", "berry-planter", "toadstool-ring", "cloud-kite"],
        level,
      ),
      level,
    );
    expect(
      effects.activeSetBonuses.some((b) => b.setId === "meadow-green" && b.tier === 2),
    ).toBe(true);
  });
});


/**
 * ROUND 2F FIX — EVERY NEED CAN ACTUALLY REACH ITS COMFORT CAP, using nothing
 * but REAL shipped content.
 *
 * Summing every comfort effect in the game gave cleanliness 0.22, happiness
 * 0.22 and energy 0.26 — each clearing the 0.25 cap because each has a SET
 * bonus topping it up (tideline, meadow-green, first-snow) — and HUNGER 0.20,
 * because no set touches hunger. So the Keep Comfort readout permanently showed
 * "Hunger −20% of −25%": an unreachable ceiling on the fastest-decaying need
 * (3.8/h), the one that binds the worst-case return, and the one players chase
 * hardest. It also made the bible's own §3.6 invariant table wrong (it predicts
 * Hardworking hunger at 37.6 after a full capped absence; the real maxed Keep
 * delivered 34). The Larder — the pantry, tier 6's headline — now carries 0.13.
 */
describe("every need reaches comfortReductionMax on a fully-built Keep (real content)", () => {
  /** Every placeable and decoration placed at once, on a tier-12 Keep so every
   * set bonus is live too. */
  function fullyBuilt(): KeepState {
    const placements: Record<string, { itemId: string; x: number; y: number }> = {};
    let n = 0;
    for (const def of [...contentPlaceables, ...contentDecorations]) {
      placements[`place-${++n}`] = { itemId: def.id, x: n % 12, y: Math.floor(n / 12) };
    }
    return { level: 12, placements };
  }

  const cap = tuning.progression.effectCaps.comfortReductionMax;

  for (const need of NEEDS) {
    it(`${need} reaches the cap (−${Math.round(cap * 100)}%)`, () => {
      const effects = resolveKeepEffects(fullyBuilt(), 12);
      expect(effects.comfort[need]).toBeCloseTo(cap, 10);
    });
  }

  it("and none EXCEEDS it — the clamp still happens exactly once", () => {
    const effects = resolveKeepEffects(fullyBuilt(), 12);
    for (const need of NEEDS) {
      expect(effects.comfort[need], need).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it("hunger's own contributions still sum to at least the cap without any set bonus", () => {
    // Hunger has no set bonus by design, so its items alone must clear the cap
    // — this is the assertion the shipped catalog failed.
    let hunger = 0;
    for (const def of [...contentPlaceables, ...contentDecorations]) {
      for (const effect of def.effects ?? []) {
        if (effect.kind !== "comfort") continue;
        if (effect.need === "hunger" || effect.need === "all") hunger += effect.decayReduction;
      }
    }
    expect(hunger).toBeGreaterThanOrEqual(cap);
  });

  it("the Larder is what carries it — removing it drops hunger below the cap", () => {
    const built = fullyBuilt();
    const withoutLarder: KeepState = {
      ...built,
      placements: Object.fromEntries(
        Object.entries(built.placements).filter(([, p]) => p.itemId !== "larder"),
      ),
    };
    expect(resolveKeepEffects(withoutLarder, 12).comfort.hunger).toBeLessThan(cap);
  });
});

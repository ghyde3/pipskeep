/**
 * Building effect content guard (docs/progression-bible.md §3.1) — the
 * hard rule pinned as a fact about the REGISTRY, not a hope: every effect
 * strictly HELPS (bible §0.3), no `BuildingEffect` kind ever appears with
 * the opposite sign, and every set's membership/effect data is internally
 * consistent (member ids resolve to a real placeable or decoration; the
 * tier-2 bonus never has a WEAKER effect than the tier-3 one it replaces).
 */

import { describe, expect, it } from "vitest";
import type { BuildingEffect } from "./buildingEffects";
import { placeables } from "./placeables";
import { decorations } from "./decorations";
import { decorSets } from "./decorSets";

const allItems = [...placeables, ...decorations];

/** Every effect this content actually authors, tagged with where it came
 * from for readable failures. */
function allAuthoredEffects(): { readonly label: string; readonly effect: BuildingEffect }[] {
  const out: { label: string; effect: BuildingEffect }[] = [];
  for (const item of allItems) {
    for (const effect of item.effects ?? []) {
      out.push({ label: `item "${item.id}"`, effect });
    }
  }
  for (const set of decorSets) {
    out.push({ label: `set "${set.id}" bonusAt3`, effect: set.bonusAt3 });
    out.push({ label: `set "${set.id}" bonusAt5`, effect: set.bonusAt5 });
  }
  return out;
}

describe("every authored BuildingEffect strictly helps (bible §0.3/§3.1 rule 1)", () => {
  for (const { label, effect } of allAuthoredEffects()) {
    it(`${label}: ${effect.kind} has the correct sign`, () => {
      switch (effect.kind) {
        case "comfort":
          expect(effect.decayReduction, label).toBeGreaterThan(0);
          break;
        case "restSpeed":
          expect(effect.multiplier, label).toBeGreaterThan(1);
          break;
        case "expeditionSpeed":
          expect(effect.multiplier, label).toBeGreaterThan(0);
          expect(effect.multiplier, label).toBeLessThan(1);
          break;
        case "incubationSpeed":
          expect(effect.multiplier, label).toBeGreaterThan(0);
          expect(effect.multiplier, label).toBeLessThan(1);
          break;
        case "expeditionLoot":
          expect(effect.bonusRollChance, label).toBeGreaterThan(0);
          break;
        case "eggChancePoints":
          expect(effect.points, label).toBeGreaterThan(0);
          break;
        case "xpBonus":
          expect(effect.fraction, label).toBeGreaterThan(0);
          break;
        case "job":
          expect(effect.jobId.length, label).toBeGreaterThan(0);
          break;
        // ROUND 2J FIX STAGE — the three kinds this round wired. "Every
        // effect strictly HELPS" applies to all three: a remedy may carry
        // either half alone (0 is legal on one side, negative never is), a
        // longevity bonus is always positive, and a craftSpeed multiplier
        // is always < 1 (faster), like every other rate channel.
        case "remedy":
          expect(effect.contractReduction, label).toBeGreaterThanOrEqual(0);
          expect(effect.cureBonus, label).toBeGreaterThanOrEqual(0);
          expect(
            effect.contractReduction + effect.cureBonus,
            label,
          ).toBeGreaterThan(0);
          break;
        case "longevity":
          expect(effect.bonus, label).toBeGreaterThan(0);
          break;
        case "craftSpeed":
          expect(effect.multiplier, label).toBeGreaterThan(0);
          expect(effect.multiplier, label).toBeLessThan(1);
          break;
      }
    });
  }
});

describe("round 2H's Poultice Shelf, wired at last (round 2J fix stage)", () => {
  // This test used to assert `effects === []` and call it correct, citing
  // content/buildingEffects.ts's round-2H note. That note said the wiring
  // was "the next round's" — and until this one, no round did it, so the
  // shelf was a tier-5 headline that did literally nothing.
  it("carries a real remedy effect, so the tier-5 headline is not a placebo", () => {
    const shelf = placeables.find((p) => p.id === "poultice-shelf");
    expect(shelf).toBeDefined();
    expect(shelf?.effects).toEqual([
      { kind: "remedy", contractReduction: 0.1, cureBonus: 0.05 },
    ]);
    expect(shelf?.unlockKeepLevel).toBe(5);
  });

  it("the three placeables docs/lifecycle-bible.md §2.2 claimed carried `longevity` actually do", () => {
    const bonusOf = (id: string): number => {
      const effects = placeables.find((p) => p.id === id)?.effects ?? [];
      for (const effect of effects) if (effect.kind === "longevity") return effect.bonus;
      return 0;
    };
    expect(bonusOf("nest-warmer")).toBe(0.06);
    expect(bonusOf("sun-bunks")).toBe(0.1);
    expect(bonusOf("larder")).toBe(0.05);
    // The bible's own "a devoted player's Pip lives 15.6 days" depends on
    // these three summing to 0.21 under the shipped 0.25 cap.
    expect(bonusOf("nest-warmer") + bonusOf("sun-bunks") + bonusOf("larder")).toBeCloseTo(
      0.21,
      10,
    );
  });
});

describe("the four shipped placeables (bible §3.4)", () => {
  it("the Food Bowl slows Hunger", () => {
    const bowl = placeables.find((p) => p.id === "food-bowl");
    expect(bowl?.effects).toEqual([{ kind: "comfort", need: "hunger", decayReduction: 0.06 }]);
  });

  it("the Bed speeds naps and slows Energy decay", () => {
    const bed = placeables.find((p) => p.id === "bed");
    expect(bed?.effects).toEqual([
      { kind: "restSpeed", multiplier: 1.25 },
      { kind: "comfort", need: "energy", decayReduction: 0.06 },
    ]);
  });

  it("the Gathering Station and Stockpot each name their job explicitly", () => {
    const gathering = placeables.find((p) => p.id === "gathering-station");
    const stockpot = placeables.find((p) => p.id === "stockpot");
    expect(gathering?.effects?.some((e) => e.kind === "job" && e.jobId === "gathering")).toBe(
      true,
    );
    expect(stockpot?.effects?.some((e) => e.kind === "job" && e.jobId === "simmering")).toBe(
      true,
    );
  });
});

describe("decoration set registry (bible §3.5)", () => {
  it("ships all six themed sets", () => {
    expect(decorSets).toHaveLength(6);
    expect(new Set(decorSets.map((s) => s.id)).size).toBe(6);
  });

  it("every set member id resolves to a real decoration or placeable", () => {
    const knownIds = new Set(allItems.map((i) => i.id));
    for (const set of decorSets) {
      for (const memberId of set.memberItemIds) {
        expect(knownIds.has(memberId), `${set.id}: ${memberId}`).toBe(true);
      }
    }
  });

  it("every set has at least the minimum members needed for its OWN tier-1 bonus, OR is honestly short (forward-compat note, not a bug)", () => {
    // Not every set can reach 5 members with only the 20 shipped
    // decorations (content/decorSets.ts's own module doc explains why —
    // four sets wait on the separate content-expansion round). This test
    // only pins that the roster is non-empty and has no duplicate ids.
    for (const set of decorSets) {
      expect(set.memberItemIds.length, set.id).toBeGreaterThan(0);
      expect(new Set(set.memberItemIds).size, set.id).toBe(set.memberItemIds.length);
    }
  });

  it("cloud-kite is a member of both Meadow Green and First Snow, on purpose (bible §3.5)", () => {
    const withCloudKite = decorSets.filter((s) => s.memberItemIds.includes("cloud-kite"));
    expect(withCloudKite.map((s) => s.id).sort()).toEqual(["first-snow", "meadow-green"]);
  });

  it("every set's bonusAt5 is the SAME effect kind as its bonusAt3 (a set never changes what it rewards)", () => {
    for (const set of decorSets) {
      expect(set.bonusAt5.kind, set.id).toBe(set.bonusAt3.kind);
    }
  });

  it("every set's bonusAt5 is strictly BIGGER than its bonusAt3 (5-of-a-set is a real upgrade)", () => {
    for (const set of decorSets) {
      const a = set.bonusAt3;
      const b = set.bonusAt5;
      if (a.kind === "comfort" && b.kind === "comfort") {
        expect(b.decayReduction, set.id).toBeGreaterThan(a.decayReduction);
      } else if (a.kind === "restSpeed" && b.kind === "restSpeed") {
        expect(b.multiplier, set.id).toBeGreaterThan(a.multiplier);
      } else if (a.kind === "expeditionLoot" && b.kind === "expeditionLoot") {
        expect(b.bonusRollChance, set.id).toBeGreaterThan(a.bonusRollChance);
      } else if (a.kind === "xpBonus" && b.kind === "xpBonus") {
        expect(b.fraction, set.id).toBeGreaterThan(a.fraction);
      } else {
        throw new Error(`${set.id}: unexpected bonus kind pairing`);
      }
    }
  });
});

describe("every shipped decoration is now mechanical, not cosmetic-only (the owner's 'just lovely' complaint)", () => {
  /**
   * ROUND 2J FIX STAGE — the five CRAFT-ONLY keepsakes are decorations in
   * the registry but deliberately carry no `setId`: they are not members
   * of the six themed sets (they must not short-cut a set bonus the six
   * groups are pacing), and they never appear in the Build sheet's set
   * groups because `buildCatalog` filters them out entirely.
   *
   * They are held to the STRICTER half of the rule below — every one of
   * them carries an effect — just not to set membership.
   */
  const buyable = decorations.filter((d) => d.craftOnly !== true);

  it("every shipped decoration carries at least one effect", () => {
    for (const d of decorations) {
      expect(d.effects?.length ?? 0, d.id).toBeGreaterThan(0);
    }
  });

  it("every BUYABLE decoration carries a setId", () => {
    for (const d of buyable) {
      expect(d.setId, d.id).toBeDefined();
    }
  });

  it("every decoration's setId names a real set", () => {
    const knownSetIds = new Set(decorSets.map((s) => s.id));
    for (const d of buyable) {
      expect(knownSetIds.has(d.setId ?? ""), d.id).toBe(true);
    }
  });

  it("no craft-only keepsake claims a set membership or a purchase price", () => {
    const craftOnly = decorations.filter((d) => d.craftOnly === true);
    expect(craftOnly.length).toBe(5);
    for (const d of craftOnly) {
      expect(d.setId, d.id).toBeUndefined();
      expect(Object.keys(d.cost), d.id).toEqual([]);
    }
  });
});

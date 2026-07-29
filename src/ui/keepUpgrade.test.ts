/**
 * Keep upgrade card model tests (spec §9 level gates, §6.3 costs, §7.4
 * roster upgrade): next-level cost/copy/affordability from content, the
 * roster section's level-3 visibility, and the maxed-out state. The DOM
 * card is untested chrome around this.
 */

import { describe, expect, it } from "vitest";
import { keepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "../content/keep";
import { tuning } from "../content/tuning";
import { createNewGame, rootReducer } from "../core/state";
import type { GameState } from "../core/state";
import {
  LEVEL_UNLOCK_COPY,
  LEVEL_UP_TOASTS,
  buildUpgradeCardModel,
} from "./keepUpgrade";

const T0 = 1_000_000;

function stateAt(
  level: number,
  resources: Record<string, number> = {},
  rosterUpgradePurchased = false,
): GameState {
  const fresh = createNewGame(7, T0);
  const granted = rootReducer(fresh, { type: "DEBUG_GRANT", resources });
  return {
    ...granted,
    keep: { ...granted.keep, level },
    rosterUpgradePurchased,
  };
}

describe("buildUpgradeCardModel — next level (spec §9/§6.3)", () => {
  it("level 1 sells level 2 with the content cost and the Forest copy", () => {
    const model = buildUpgradeCardModel(stateAt(1));
    expect(model.currentLevel).toBe(1);
    expect(model.next?.level).toBe(2);
    // Content is the single source — the label is rendered FROM tuning,
    // never from a parallel constant, so a rebalance flows through.
    const cost = tuning.keepLevelCosts[2];
    expect(keepLevels.find((l) => l.level === 2)?.cost).toEqual(cost);
    expect(model.next?.costLabel).toBe(
      `${cost.wood} Wood + ${cost.fiber} Fiber`,
    );
    expect(model.next?.unlockCopy).toContain("Forest");
    expect(model.next?.affordable).toBe(false);
    expect(model.next?.missingLabel).toBe(
      `Needs ${cost.wood} more Wood and ${cost.fiber} more Fiber`,
    );
  });

  it("a covered bundle flips affordable and clears the shortfall", () => {
    const model = buildUpgradeCardModel(stateAt(1, { wood: 15, fiber: 10 }));
    expect(model.next?.affordable).toBe(true);
    expect(model.next?.missingLabel).toBe("");
  });

  it("level 3 has no next level — the card celebrates instead", () => {
    const model = buildUpgradeCardModel(stateAt(3));
    expect(model.next).toBeNull();
    expect(model.maxedCopy.length).toBeGreaterThan(10);
  });
});

describe("buildUpgradeCardModel — roster upgrade (spec §7.4)", () => {
  it("hides Cozy Bunks below the content prerequisite level", () => {
    expect(keepUpgrades[ROSTER_UPGRADE_ID]?.prerequisiteLevel).toBe(3);
    expect(buildUpgradeCardModel(stateAt(1)).roster.visible).toBe(false);
    expect(buildUpgradeCardModel(stateAt(2)).roster.visible).toBe(false);
  });

  it("shows it at level 3 with cost + affordability from content", () => {
    const short = buildUpgradeCardModel(stateAt(3));
    expect(short.roster.visible).toBe(true);
    expect(short.roster.owned).toBe(false);
    expect(short.roster.name).toBe("Cozy Bunks");
    expect(short.roster.costLabel).toBe("10 Wood + 8 Shell + 4 Driftwood");
    expect(short.roster.affordable).toBe(false);
    expect(short.roster.missingLabel).toContain("more Wood");

    const rich = buildUpgradeCardModel(
      stateAt(3, { wood: 10, shell: 8, driftwood: 4 }),
    );
    expect(rich.roster.affordable).toBe(true);
  });

  it("owned reads as built, whatever the satchel holds", () => {
    const model = buildUpgradeCardModel(stateAt(3, {}, true));
    expect(model.roster.visible).toBe(true);
    expect(model.roster.owned).toBe(true);
  });
});

describe("celebration copy — every buyable level has a toast", () => {
  it("covers levels 2 and 3 with warm lines", () => {
    for (const def of keepLevels) {
      if (def.level === 1) continue;
      expect(LEVEL_UP_TOASTS[def.level], `toast for ${def.level}`).toBeTypeOf(
        "string",
      );
      expect(LEVEL_UNLOCK_COPY[def.level], `unlock for ${def.level}`).toBeTypeOf(
        "string",
      );
    }
  });
});

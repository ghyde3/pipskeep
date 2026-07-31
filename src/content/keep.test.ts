/**
 * THE 12-TIER LADDER (docs/progression-bible.md §2) — content-authoring
 * guard. `core/economy/reachability.test.ts` proves the ECONOMY holds
 * (every priced tier is affordable, the escalation chain is strictly
 * increasing); `content/validate.ts` proves every tier has a non-empty
 * unlock list. This file pins the shape of the AUTHORING itself: twelve
 * tiers, one cost per tier matching `tuning.progression.levelCosts`
 * exactly (the "two numbers, two files" trap bible §8.6 risk 1 warns
 * about), and headline copy that names something real.
 */

import { describe, expect, it } from "vitest";
import { keepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "./keep";
import { tuning } from "./tuning";
import { placeables } from "./placeables";
import { expeditions } from "./expeditions";
import { jobs } from "./jobs";
import { gridBounds } from "../core/keep";
import type { KeepLevel } from "../core/keep";

describe("the 12-tier Keep ladder", () => {
  it("has exactly twelve tiers, numbered 1 through 12 with no gaps or repeats", () => {
    expect(keepLevels.map((l) => l.level)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("tier 1 costs nothing (the starting tier)", () => {
    expect(keepLevels[0]!.cost).toEqual({});
  });

  it("every tier's cost matches tuning.progression.levelCosts exactly — ONE source of truth", () => {
    for (const level of keepLevels) {
      const expected = tuning.progression.levelCosts[level.level] ?? {};
      expect(level.cost, `tier ${level.level}`).toEqual(expected);
    }
  });

  it("round 2J: all eleven non-starting tiers are priced (the fifth resource lets the whole ladder cost something real)", () => {
    const pricedTiers = keepLevels
      .filter((l) => Object.keys(l.cost).length > 0)
      .map((l) => l.level);
    expect(pricedTiers).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("round 2J: tiers 2 and 3 stay byte-identical to the shipped on-ramp (untouched by the re-pricing)", () => {
    expect(keepLevels.find((l) => l.level === 2)!.cost).toEqual({ wood: 5, fiber: 6 });
    expect(keepLevels.find((l) => l.level === 3)!.cost).toEqual({ wood: 22, fiber: 14 });
  });

  it("round 2J: tier 4 is deliberately lodestone-free (it is the tier that unlocks the Shore, lodestone's own faucet)", () => {
    const tier4 = keepLevels.find((l) => l.level === 4)!;
    expect(tier4.cost.lodestone).toBeUndefined();
  });

  it("round 2J: every resource column is non-decreasing tier over tier — a later tier never asks for less", () => {
    const resourceIds = ["wood", "fiber", "shell", "driftwood", "lodestone"] as const;
    for (const resourceId of resourceIds) {
      let prev = 0;
      for (const level of keepLevels) {
        const amount = level.cost[resourceId] ?? 0;
        expect(amount, `tier ${level.level} ${resourceId}`).toBeGreaterThanOrEqual(prev);
        prev = amount;
      }
    }
  });

  it("every tier's unlock list names something a player can look forward to (non-empty, real words)", () => {
    for (const level of keepLevels) {
      expect(level.unlocks.length, `tier ${level.level}`).toBeGreaterThan(0);
      for (const line of level.unlocks) {
        expect(line.trim().length, `tier ${level.level}`).toBeGreaterThan(0);
      }
    }
  });

  it("Cozy Bunks is purchasable from tier 4 — the Shore, which supplies its Shell/Driftwood cost", () => {
    const upgrade = keepUpgrades[ROSTER_UPGRADE_ID]!;
    expect(upgrade.prerequisiteLevel).toBe(4);
  });
});

/**
 * THE DEAD-TIER GUARD (ruling #2: "EVERY tier must unlock something real; a
 * tier that just raises a number is a dead tier").
 *
 * A review mutation proved this was hope, not enforcement: moving both tier-8
 * placeables to tier 9 left the suite green at 1,969 tests while `keep.ts`
 * kept advertising "the Workbench, the Mending job, the Sun Bunks". The
 * validator now computes the real gates per tier (`checkEveryTierGatesSomething`
 * in `content/validate.ts`, which `validate.test.ts` exercises against a
 * deliberately-dead ladder); these two assertions are the authoring-side pair —
 * that a gate exists, and that the HEADLINE names it.
 */
describe("every tier hands over something real, and says which thing", () => {
  /** Named things that gate at exactly `level` — the subset of bible §2.4's
   * unlock currencies that have a player-facing NAME. */
  function namedGatesAt(level: number): readonly string[] {
    const names: string[] = [];
    for (const p of placeables) {
      if (p.unlockKeepLevel === level) names.push(p.name);
    }
    for (const e of Object.values(expeditions)) {
      if (e.unlockKeepLevel === level) names.push(e.name);
    }
    for (const j of Object.values(jobs)) {
      const station = placeables.find((p) => p.id === j.stationItemId);
      if (station?.unlockKeepLevel === level) names.push(j.name);
    }
    for (const u of Object.values(keepUpgrades)) {
      if (u.prerequisiteLevel === level) names.push(u.name);
    }
    return names;
  }

  /** Every gate, named or numeric. */
  function anyGateAt(level: number): boolean {
    if (namedGatesAt(level).length > 0) return true;
    const prog = tuning.progression;
    if (prog.gridGrowth[level] !== undefined) return true;
    if (prog.rosterCapBonusByLevel[level] !== undefined) return true;
    if (prog.setBonus.tier1LiveAtKeepLevel === level) return true;
    if (prog.setBonus.tier2LiveAtKeepLevel === level) return true;
    return false;
  }

  for (const def of keepLevels.filter((l) => l.level >= 2)) {
    it(`tier ${def.level} gates real content at exactly ${def.level}`, () => {
      expect(
        anyGateAt(def.level),
        `tier ${def.level} advertises "${def.headline}" but nothing in content gates at ${def.level}`,
      ).toBe(true);
    });
  }

  /**
   * The stronger half: the headline must NAME one of the things that actually
   * gates there, so the copy cannot drift away from the mechanics. Skipped for
   * tiers whose only gate is numeric (more ground, another bed) — those have no
   * content name to quote, and `anyGateAt` above is their guard.
   */
  for (const def of keepLevels.filter((l) => l.level >= 2)) {
    const named = (): readonly string[] => {
      const names: string[] = [];
      for (const p of placeables) if (p.unlockKeepLevel === def.level) names.push(p.name);
      for (const e of Object.values(expeditions)) {
        if (e.unlockKeepLevel === def.level) names.push(e.name);
      }
      for (const u of Object.values(keepUpgrades)) {
        if (u.prerequisiteLevel === def.level) names.push(u.name);
      }
      return names;
    };
    it(`tier ${def.level}'s headline names something that gates there`, () => {
      const names = named();
      if (names.length === 0) return; // numeric-only tier, covered above
      const headline = def.headline.toLowerCase();
      const quoted = names.filter((n) => headline.includes(n.toLowerCase()));
      expect(
        quoted.length,
        `tier ${def.level}'s headline "${def.headline}" names none of what it unlocks (${names.join(", ")})`,
      ).toBeGreaterThan(0);
    });
  }

  it("no headline leads with a bare number — the XP bar's only job is to name the carrot", () => {
    for (const def of keepLevels) {
      expect(def.headline.trimStart().startsWith("+"), `tier ${def.level}`).toBe(false);
      expect(def.headline.trim().length, `tier ${def.level}`).toBeGreaterThan(3);
    }
  });

  it("every tier's headline is unique — two tiers promising the same thing is a dead tier in disguise", () => {
    const headlines = keepLevels.map((l) => l.headline);
    expect(new Set(headlines).size).toBe(headlines.length);
  });
});

/**
 * GRID GROWTH at tiers 5/7/9 — three advertised ladder unlocks whose only
 * previous coverage stopped at level 3, so the documented 8×8 → 8×12 → 10×12 →
 * 10×14 → 12×14 progression and its 168-tile perf ceiling were unasserted.
 */
describe("gridBounds — the whole growth ladder, not just the shipped tier 2", () => {
  const expected: readonly (readonly [number, number, number])[] = [
    // [level, cols, rows]
    [1, 8, 8],
    [2, 8, 12],
    [3, 8, 12],
    [4, 8, 12],
    [5, 10, 12],
    [6, 10, 12],
    [7, 10, 14],
    [8, 10, 14],
    [9, 12, 14],
    [10, 12, 14],
    [11, 12, 14],
    [12, 12, 14],
  ];

  for (const [level, cols, rows] of expected) {
    it(`level ${level} is ${cols}x${rows}`, () => {
      const bounds = gridBounds(level as KeepLevel);
      expect(bounds.cols).toBe(cols);
      expect(bounds.rows).toBe(rows);
    });
  }

  it("stops at 168 tiles — the perf ceiling bible §2.2/§8.6 sets on purpose", () => {
    const top = gridBounds(12);
    expect(top.cols * top.rows).toBe(168);
  });

  it("never shrinks as the Keep grows", () => {
    for (let level = 2; level <= 12; level++) {
      const prev = gridBounds((level - 1) as KeepLevel);
      const now = gridBounds(level as KeepLevel);
      expect(now.cols, `level ${level} cols`).toBeGreaterThanOrEqual(prev.cols);
      expect(now.rows, `level ${level} rows`).toBeGreaterThanOrEqual(prev.rows);
    }
  });
});

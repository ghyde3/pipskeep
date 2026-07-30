/**
 * THE LEVEL CURVE — the bar-movement guarantee (docs/progression-bible.md
 * §0.2/§1.4) and the exact-threshold PURCHASE_KEEP_LEVEL gate (§1.2),
 * asserted against the REAL `tuning.progression` content so a future
 * retune of the ladder fails HERE, not in playtest.
 */

import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { createNewGame, rootReducer } from "../state";
import type { GameState } from "../state";
import { isNextTierXpReady } from "./xp";

const levelXp = contentTuning.progression.levelXp;
const xp = contentTuning.progression.xp;
const bar = contentTuning.progression.barVisibility;

/** Cumulative requirement for tier N (1-indexed); tier 1 is free. */
function requirementFor(tier: number): number {
  return levelXp[tier - 1] ?? 0;
}

describe("the bar-movement guarantee, asserted for EVERY tier (bible §0.2/§1.4)", () => {
  it("levelXp is strictly increasing end to end", () => {
    for (let i = 1; i < levelXp.length; i++) {
      expect(levelXp[i]).toBeGreaterThan(levelXp[i - 1] as number);
    }
  });

  it("one care action (a single Pet) clears minCareActionFraction of EVERY tier's bar", () => {
    for (let tier = 2; tier <= levelXp.length; tier++) {
      const span = requirementFor(tier) - requirementFor(tier - 1);
      const fraction = xp.care / span;
      expect(fraction, `tier ${tier}`).toBeGreaterThanOrEqual(bar.minCareActionFraction);
    }
  });

  it("one care round (6 taps) + one Meadow round-trip clears minCareRoundPlusTripFraction of EVERY tier's bar", () => {
    const meadow = contentExpeditions.meadow;
    // revealXp's own formula, restated directly from tuning (bible §1.3
    // row 10) so this test doesn't depend on core/progression/xp.ts.
    const meadowReveal =
      xp.revealBase + xp.revealPer5Min * Math.floor(meadow.durationMs / (5 * 60_000));
    const careRoundPlusTrip = 6 * xp.care + xp.expeditionSend + meadowReveal;
    for (let tier = 2; tier <= levelXp.length; tier++) {
      const span = requirementFor(tier) - requirementFor(tier - 1);
      const fraction = careRoundPlusTrip / span;
      expect(fraction, `tier ${tier}`).toBeGreaterThanOrEqual(bar.minCareRoundPlusTripFraction);
    }
  });

  it("the tier-12 row is the binding one (steepening it must fail here first)", () => {
    const span12 = requirementFor(12) - requirementFor(11);
    expect(xp.care / span12).toBeCloseTo(bar.minCareActionFraction, 2);
  });

  /**
   * THE RENOWN SPAN IS A BAR TOO, AND IT WAS BREAKING THE CONTRACT.
   *
   * The loop above walks every TIER and stops at 12. `renown.xpPerLevel` was
   * 3,000 — LARGER than tier 12's 2,300 span — so a 4-XP care action was
   * 0.133% of the endgame bar against an asserted minimum of 0.15%. Measured
   * live at Lv 12 with the maximum xpBonus, a Pet advanced the fill by 0.093px
   * on a 56px track: the endgame bar moved less than the game's own contract
   * allows, one row past where this file was looking. `xpPerLevel` is now
   * 2,000 and the floor covers the Renown bar as well.
   */
  it("one care action clears minCareActionFraction of the RENOWN bar too (bible §0.2, §1.7)", () => {
    const span = contentTuning.progression.renown.xpPerLevel;
    expect(xp.care / span).toBeGreaterThanOrEqual(bar.minCareActionFraction);
  });

  it("one care round + a Meadow trip clears minCareRoundPlusTripFraction of the RENOWN bar", () => {
    const meadow = contentExpeditions.meadow;
    const meadowReveal =
      xp.revealBase + xp.revealPer5Min * Math.floor(meadow.durationMs / (5 * 60_000));
    const careRoundPlusTrip = 6 * xp.care + xp.expeditionSend + meadowReveal;
    const span = contentTuning.progression.renown.xpPerLevel;
    expect(careRoundPlusTrip / span).toBeGreaterThanOrEqual(bar.minCareRoundPlusTripFraction);
  });

  it("the Renown span is no steeper than the steepest TIER — the endgame bar never moves less", () => {
    const steepestTierSpan = Math.max(
      ...Array.from({ length: levelXp.length - 1 }, (_, i) => requirementFor(i + 2) - requirementFor(i + 1)),
    );
    expect(contentTuning.progression.renown.xpPerLevel).toBeLessThanOrEqual(steepestTierSpan);
  });
});

describe("the bar-moves-at-every-level property: a single care action ALWAYS produces a visible XP delta", () => {
  it("a Pet at every tier (1..12) advances keepXp by exactly xp.care", () => {
    for (let tier = 1; tier <= 12; tier++) {
      const base = createNewGame(7, 1_000_000);
      const pipId = base.activePipId;
      const state: GameState = { ...base, keep: { ...base.keep, level: tier } };
      const next = rootReducer(state, { type: "PET", pipId, at: 1_000_001 });
      expect(next.lastCareOutcome?.applied, `tier ${tier}`).toBe(true);
      expect(next.keepXp - state.keepXp, `tier ${tier}`).toBe(xp.care);
      expect(next.keepXp, `tier ${tier}`).toBeGreaterThan(state.keepXp);
    }
  });
});

describe("PURCHASE_KEEP_LEVEL's needsXp gate fires at the EXACT threshold (bible §1.2)", () => {
  it("refuses one XP below the gate, succeeds exactly at it (level 1 → 2)", () => {
    const base = createNewGame(7, 1_000_000);
    const required = requirementFor(2);
    const short: GameState = {
      ...base,
      keepXp: required - 1,
      resources: { wood: 999, fiber: 999 },
    };
    expect(rootReducer(short, { type: "PURCHASE_KEEP_LEVEL", at: 0 })).toBe(short);

    const exact: GameState = { ...base, keepXp: required, resources: { wood: 999, fiber: 999 } };
    const bought = rootReducer(exact, { type: "PURCHASE_KEEP_LEVEL", at: 0 });
    expect(bought.keep.level).toBe(2);
    expect(bought.lastLevelUp).toEqual({ at: 0, fromLevel: 1, toLevel: 2 });
  });

  it("isNextTierXpReady agrees with the reducer at every tier boundary", () => {
    for (let tier = 1; tier < 12; tier++) {
      const required = requirementFor(tier + 1);
      expect(isNextTierXpReady(required - 1, tier)).toBe(false);
      expect(isNextTierXpReady(required, tier)).toBe(true);
    }
  });

  it("past tier 12 there is no next tier — always refuses regardless of XP", () => {
    const base = createNewGame(7, 1_000_000);
    const maxed: GameState = {
      ...base,
      keep: { level: 12, placements: {} },
      keepXp: 1_000_000,
      resources: { wood: 999, fiber: 999, shell: 999, driftwood: 999 },
    };
    expect(rootReducer(maxed, { type: "PURCHASE_KEEP_LEVEL", at: 0 })).toBe(maxed);
  });
});

describe("expedition unlocks gate correctly across the new ladder (bible §2.1)", () => {
  const spread: readonly { readonly id: string; readonly level: number }[] = [
    { id: "meadow", level: 1 },
    { id: "bramblewick", level: 1 },
    { id: "forest", level: 2 },
    { id: "snowdrift", level: 3 },
    { id: "shore", level: 4 },
    { id: "lanterngrotto", level: 5 },
  ];

  it("each biome is locked one tier below its unlock and sendable at it", () => {
    for (const { id, level } of spread) {
      const base = createNewGame(7, 1_000_000);
      const pipId = base.activePipId;

      if (level > 1) {
        const below: GameState = { ...base, keep: { level: level - 1, placements: {} } };
        const refused = rootReducer(below, {
          type: "ASSIGN_EXPEDITION",
          pipId,
          expeditionId: id,
          at: 0,
        });
        expect(refused.lastAssignOutcome, `${id} below tier ${level}`).toMatchObject({
          ok: false,
          reason: "locked",
        });
      }

      const at: GameState = { ...base, keep: { level, placements: {} } };
      const sent = rootReducer(at, {
        type: "ASSIGN_EXPEDITION",
        pipId,
        expeditionId: id,
        at: 0,
      });
      expect(sent.lastAssignOutcome, `${id} at tier ${level}`).toMatchObject({ ok: true });
    }
  });
});

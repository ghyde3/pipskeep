/**
 * PER-PIP LEVELS — the pure calculator (spec §16 v1.5,
 * docs/lifecycle-bible.md §1). Curve, XP sources (looped over the full
 * award table), and the level-effect getters. Composition into
 * `effectiveRates`/`effectiveExpeditionDurationMs` and the round's
 * fragile invariant (the shared care-ease channel) are
 * `level.balance.test.ts`'s job; this file tests `level.ts` in isolation.
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import { LifeStage, PipActivity } from "./types";
import type { PipState } from "./types";
import {
  ailmentSurvivedPipXp,
  awardPipXp,
  careActionPipXp,
  contractReductionFor,
  countdownExtendMultiplierFor,
  cureBonusFor,
  evolvePipXp,
  expeditionSpeedMultiplierFor,
  jobTickPipXp,
  levelForXp,
  lifespanBonusFor,
  masteryTierPipXp,
  pipLevel,
  pipXpAmount,
  seasoningFor,
  tripPipXp,
  xpForLevel,
} from "./level";
import type { LevelEffectsTuning } from "./level";

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Testpip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      accessorySlots: 1,
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: { hunger: 100, cleanliness: 100, happiness: 100, energy: 100 },
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

const MAX_LEVEL = tuning.lifecycle.level.maxLevel;
const LEVEL_XP = tuning.lifecycle.level.levelXp;

describe("pipLevel / pipXpAmount — the undefined ≡ default contract", () => {
  it("a fresh Pip (no level/pipXp fields) is level 1 with 0 XP", () => {
    const pip = makePip();
    expect(pipLevel(pip)).toBe(1);
    expect(pipXpAmount(pip)).toBe(0);
  });

  it("reads explicit values when present", () => {
    const pip = makePip({ level: 6, pipXp: 700 });
    expect(pipLevel(pip)).toBe(6);
    expect(pipXpAmount(pip)).toBe(700);
  });
});

describe("levelForXp / xpForLevel — the curve", () => {
  it("0 XP is exactly level 1 (levelXp[0] === 0 by content contract)", () => {
    expect(LEVEL_XP[0]).toBe(0);
    expect(levelForXp(0)).toBe(1);
  });

  it("is inclusive at every threshold — exactly levelXp[i] reaches level i+1", () => {
    for (let i = 0; i < LEVEL_XP.length; i++) {
      const threshold = LEVEL_XP[i] as number;
      expect(levelForXp(threshold)).toBe(i + 1);
    }
  });

  it("1 XP short of a threshold has not yet reached it", () => {
    for (let i = 1; i < LEVEL_XP.length; i++) {
      const threshold = LEVEL_XP[i] as number;
      expect(levelForXp(threshold - 1)).toBeLessThan(i + 1);
    }
  });

  it("never exceeds maxLevel, however much XP is thrown at it", () => {
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  it("xpForLevel is levelForXp's inverse at every rung, and clamps out-of-range levels", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
    }
    expect(xpForLevel(0)).toBe(xpForLevel(1));
    expect(xpForLevel(MAX_LEVEL + 5)).toBe(xpForLevel(MAX_LEVEL));
  });

  it("the curve is a content contract, not a hardcoded assumption: exactly maxLevel entries, strictly ascending", () => {
    expect(LEVEL_XP.length).toBe(MAX_LEVEL);
    for (let i = 1; i < LEVEL_XP.length; i++) {
      expect(LEVEL_XP[i] as number).toBeGreaterThan(LEVEL_XP[i - 1] as number);
    }
  });
});

describe("awardPipXp — the sole mutator", () => {
  it("a non-positive amount is a pure no-op, returned BY REFERENCE", () => {
    const pip = makePip({ level: 3, pipXp: 250 });
    expect(awardPipXp(pip, 0)).toBe(pip);
    expect(awardPipXp(pip, -5)).toBe(pip);
  });

  it("accumulates onto the EXISTING total, never resets it", () => {
    const pip = makePip({ pipXp: 10 });
    const awarded = awardPipXp(pip, 5);
    expect(awarded.pipXp).toBe(15);
  });

  it("recomputes level from the new total — crossing a threshold levels up", () => {
    const pip = makePip(); // level 1, 0 XP
    const threshold2 = LEVEL_XP[1] as number;
    const awarded = awardPipXp(pip, threshold2);
    expect(awarded.level).toBe(2);
  });

  it("levels only ever go UP — awarding more XP never lowers level or pipXp", () => {
    let pip = makePip();
    let prevLevel = pipLevel(pip);
    let prevXp = pipXpAmount(pip);
    for (let i = 0; i < 20; i++) {
      pip = awardPipXp(pip, 37);
      expect(pipLevel(pip)).toBeGreaterThanOrEqual(prevLevel);
      expect(pipXpAmount(pip)).toBeGreaterThan(prevXp);
      prevLevel = pipLevel(pip);
      prevXp = pipXpAmount(pip);
    }
  });

  it("is pure — the input Pip is never mutated", () => {
    const pip = makePip({ pipXp: 5 });
    const snapshot = structuredClone(pip);
    awardPipXp(pip, 100);
    expect(pip).toEqual(snapshot);
  });

  it("does not touch any other field", () => {
    const pip = makePip({ pipXp: 5, mastery: { meadow: 3 } });
    const awarded = awardPipXp(pip, 50);
    expect({ ...awarded, level: pip.level, pipXp: pip.pipXp }).toEqual(pip);
  });
});

// ---------------------------------------------------------------------------
// XP SOURCES (bible §1.1) — the award table, looped so every row is
// exercised the same way and a future row nobody wires a test for is
// still covered generically.
// ---------------------------------------------------------------------------

describe("XP sources — the award table (bible §1.1), looped", () => {
  const cfg = tuning.lifecycle.level.xp;

  const SOURCES: readonly { readonly name: string; readonly amount: number }[] = [
    { name: "care", amount: careActionPipXp() },
    { name: "ailmentSurvived", amount: ailmentSurvivedPipXp() },
    { name: "evolve", amount: evolvePipXp() },
  ];

  it("every flat-rate source reads its exact tuning value, and every one is positive", () => {
    expect(careActionPipXp()).toBe(cfg.care);
    expect(ailmentSurvivedPipXp()).toBe(cfg.ailmentSurvived);
    expect(evolvePipXp()).toBe(cfg.evolve);
    for (const source of SOURCES) {
      expect(source.amount, source.name).toBeGreaterThan(0);
    }
  });

  it("tripPipXp: tripBase + tripPer5Min × ⌊durationMs / 5min⌋, exact at every 5-minute boundary", () => {
    const FIVE_MIN = 5 * 60 * 1000;
    expect(tripPipXp(0)).toBe(cfg.tripBase);
    expect(tripPipXp(FIVE_MIN - 1)).toBe(cfg.tripBase);
    expect(tripPipXp(FIVE_MIN)).toBe(cfg.tripBase + cfg.tripPer5Min);
    expect(tripPipXp(FIVE_MIN * 9)).toBe(cfg.tripBase + cfg.tripPer5Min * 9);
  });

  it("tripPipXp matches every shipped expedition's bible-documented value", () => {
    // bible §1.1: Meadow 10, Forest 14, Shore 20, Bramblewick 24,
    // Snowdrift 32, Lanterngrotto 44 — pinned so a retune of
    // tripBase/tripPer5Min surfaces here against named numbers, not just
    // an abstract formula.
    const FIVE_MIN = 5 * 60 * 1000;
    const named: readonly [string, number][] = [
      ["meadow", 10],
      ["forest", 14],
      ["shore", 20],
      ["bramblewick", 24],
      ["snowdrift", 32],
      ["lanterngrotto", 44],
    ];
    for (const [expeditionId, expected] of named) {
      const durationMs =
        (tuning.expeditions as Readonly<Record<string, { readonly durationMs: number }>>)[
          expeditionId
        ]?.durationMs;
      if (durationMs === undefined) continue; // content-dependent, defensive
      expect(tripPipXp(durationMs), expeditionId).toBe(
        cfg.tripBase + cfg.tripPer5Min * Math.floor(durationMs / FIVE_MIN),
      );
      expect(tripPipXp(durationMs), expeditionId).toBe(expected);
    }
  });

  it("jobTickPipXp: jobTick × ticks, never negative", () => {
    expect(jobTickPipXp(0)).toBe(0);
    expect(jobTickPipXp(1)).toBe(cfg.jobTick);
    expect(jobTickPipXp(96)).toBe(cfg.jobTick * 96); // a full 16h-capped absence
    expect(jobTickPipXp(-5)).toBe(0);
  });

  it("masteryTierPipXp: masteryTierPerTier × newTier, never negative", () => {
    expect(masteryTierPipXp(0)).toBe(0);
    expect(masteryTierPipXp(1)).toBe(cfg.masteryTierPerTier);
    expect(masteryTierPipXp(3)).toBe(cfg.masteryTierPerTier * 3);
    expect(masteryTierPipXp(-2)).toBe(0);
  });

  it("a full capped absence's job ticks (96) pay in the same order of magnitude as an engaged day of trips (bible §1.1: ~96 vs ~100)", () => {
    // Not a precise reconstruction of the bible's own worked example (its
    // exact trip mix is narrative, not a codified formula) — just the
    // load-bearing shape: a parked workhorse and an actively-played
    // adventurer must not be orders of magnitude apart, which is the
    // whole point of `jobTick` staying at 1 rather than being nerfed.
    const workhorse = jobTickPipXp(96);
    expect(workhorse).toBeGreaterThan(50);
    expect(workhorse).toBeLessThan(150);
  });
});

// ---------------------------------------------------------------------------
// LEVEL EFFECTS (bible §1.3) — every getter is a strict identity at level
// 1 or when the tuning is absent, and every one moves in its documented
// direction as level rises.
// ---------------------------------------------------------------------------

describe("level-effect getters — identity at level 1, and absent tuning", () => {
  const GETTERS: readonly {
    readonly name: string;
    readonly fn: (pip: PipState, tuning?: LevelEffectsTuning) => number;
    readonly identity: number;
  }[] = [
    { name: "seasoningFor", fn: seasoningFor, identity: 0 },
    { name: "expeditionSpeedMultiplierFor", fn: expeditionSpeedMultiplierFor, identity: 1 },
    { name: "contractReductionFor", fn: contractReductionFor, identity: 0 },
    { name: "countdownExtendMultiplierFor", fn: countdownExtendMultiplierFor, identity: 1 },
    { name: "cureBonusFor", fn: cureBonusFor, identity: 0 },
    { name: "lifespanBonusFor", fn: lifespanBonusFor, identity: 0 },
  ];

  for (const { name, fn, identity } of GETTERS) {
    it(`${name} is the identity at level 1 (undefined ≡ 1)`, () => {
      expect(fn(makePip())).toBe(identity);
      expect(fn(makePip({ level: 1 }))).toBe(identity);
    });

    it(`${name} is the identity whenever the injected tuning has no lifecycle.level table at all (every pre-2H fixture)`, () => {
      // A bare tuning object with no `lifecycle` key whatsoever — the
      // shape hundreds of pre-2H fixtures across this codebase pass.
      // Even a MAX-level Pip must see the untouched identity here.
      expect(fn(makePip({ level: MAX_LEVEL }), {})).toBe(identity);
    });
  }

  it("every getter moves in its documented direction as level rises (bible §1.3's table)", () => {
    // seasoning/contractReduction/cureBonus/lifespanBonus: HIGHER is
    // better (a reduction/bonus fraction). expeditionSpeed: LOWER is
    // faster. countdownExtend: HIGHER is more time to react.
    const rising = [seasoningFor, contractReductionFor, cureBonusFor, lifespanBonusFor];
    for (const fn of rising) {
      expect(fn(makePip({ level: MAX_LEVEL }))).toBeGreaterThan(fn(makePip({ level: 1 })));
    }
    expect(expeditionSpeedMultiplierFor(makePip({ level: MAX_LEVEL }))).toBeLessThan(
      expeditionSpeedMultiplierFor(makePip({ level: 1 })),
    );
    expect(countdownExtendMultiplierFor(makePip({ level: MAX_LEVEL }))).toBeGreaterThan(
      countdownExtendMultiplierFor(makePip({ level: 1 })),
    );
  });

  it("clamps a level above the table's own length to its last entry, rather than throwing", () => {
    expect(() => seasoningFor(makePip({ level: 999 }))).not.toThrow();
    expect(seasoningFor(makePip({ level: 999 }))).toBe(seasoningFor(makePip({ level: MAX_LEVEL })));
  });

  it("a level BELOW 1 (defensive) clamps to the level-1 identity, never throws or goes negative", () => {
    expect(() => seasoningFor(makePip({ level: 0 }))).not.toThrow();
    expect(seasoningFor(makePip({ level: 0 }))).toBe(0);
  });
});

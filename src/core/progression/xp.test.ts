/**
 * Pure Keep-XP calculator tests (docs/progression-bible.md §1.3) — one
 * small function per award-table row, tested against an injected
 * `KeepXpTuning` fixture so these never drift with a real-content
 * rebalance (the reducer-integration tests in `core/progression/
 * keepXp.test.ts` cover the real content).
 */

import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "../../content/tuning";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { tuning as contentTuning } from "../../content/tuning";
import {
  albumXpFromDeltas,
  bountyCompleteXp,
  bountyDayClearXp,
  careActionXp,
  evolveXp,
  expeditionSendXp,
  firstBuildXp,
  firstJobXp,
  hatchXp,
  isNextTierXpReady,
  jobTickXp,
  masteryTierXp,
  revealXp,
  rosterUpgradeXp,
  sanctuaryFirstArrivalXp,
  streakDayXp,
  tierBarProgress,
  xpRequiredForLevel,
} from "./xp";
import type { KeepXpTuning } from "./xp";

/** A small, hand-picked fixture — distinct numbers per field so a test
 * that reads the wrong one fails loudly. */
const FAKE_TUNING: KeepXpTuning = {
  progression: {
    levelXp: [0, 100, 250, 500],
    // Renown's span, deliberately a round 200 so the fixture's Renown
    // assertions read as arithmetic rather than as the shipped tuning.
    renown: { xpPerLevel: 200, flairEveryLevels: 1 },
    xp: {
      care: 4,
      expeditionSend: 2,
      revealBase: 6,
      revealPer5Min: 1,
      hatch: 40,
      evolve: 90,
      firstBuild: 25,
      firstJob: 20,
      jobTick: 1,
      bountyComplete: 15,
      bountyDayClear: 25,
      streakDayBase: 20,
      streakDayPerTier: 5,
      rosterUpgrade: 60,
      masteryTierPerTier: 25,
      albumSeen: 10,
      albumCaught: 50,
      albumVariant: 35,
      sanctuaryFirstArrival: 20,
    },
  },
};

describe("the flat per-action calculators (bible §1.3)", () => {
  it("each returns exactly its tuning value", () => {
    expect(careActionXp(FAKE_TUNING)).toBe(4);
    expect(expeditionSendXp(FAKE_TUNING)).toBe(2);
    expect(hatchXp(FAKE_TUNING)).toBe(40);
    expect(evolveXp(FAKE_TUNING)).toBe(90);
    expect(firstBuildXp(FAKE_TUNING)).toBe(25);
    expect(firstJobXp(FAKE_TUNING)).toBe(20);
    expect(rosterUpgradeXp(FAKE_TUNING)).toBe(60);
    expect(sanctuaryFirstArrivalXp(FAKE_TUNING)).toBe(20);
  });

  it("default parameter reads the REAL content tuning (no fixture needed)", () => {
    expect(careActionXp()).toBe(contentTuning.progression.xp.care);
    expect(hatchXp()).toBe(contentTuning.progression.xp.hatch);
  });
});

describe("revealXp — bible row 10's formula", () => {
  it("revealBase + revealPer5Min × ⌊durationMs / 5min⌋", () => {
    expect(revealXp(5 * MINUTE_MS, FAKE_TUNING)).toBe(6 + 1 * 1);
    expect(revealXp(12 * MINUTE_MS, FAKE_TUNING)).toBe(6 + 1 * 2); // floors, not rounds
    expect(revealXp(0, FAKE_TUNING)).toBe(6);
  });

  it("matches the bible's exact per-biome table against REAL content durations: Meadow 7 · Forest 9 · Shore 12 · Bramblewick 14 · Snowdrift 18 · Grotto 24", () => {
    const expected: Readonly<Record<string, number>> = {
      meadow: 7,
      forest: 9,
      shore: 12,
      bramblewick: 14,
      snowdrift: 18,
      lanterngrotto: 24,
    };
    for (const [id, xp] of Object.entries(expected)) {
      const durationMs = contentExpeditions[id as keyof typeof contentExpeditions].durationMs;
      expect(revealXp(durationMs), id).toBe(xp);
    }
  });
});

describe("jobTickXp / bountyCompleteXp / bountyDayClearXp — count × tuning value, floored at 0", () => {
  it("scales with the count", () => {
    expect(jobTickXp(0, FAKE_TUNING)).toBe(0);
    expect(jobTickXp(3, FAKE_TUNING)).toBe(3);
    expect(bountyCompleteXp(2, FAKE_TUNING)).toBe(30);
    expect(bountyDayClearXp(1, FAKE_TUNING)).toBe(25);
  });

  it("never goes negative even if handed a negative count (defensive)", () => {
    expect(jobTickXp(-5, FAKE_TUNING)).toBe(0);
    expect(bountyCompleteXp(-1, FAKE_TUNING)).toBe(0);
    expect(bountyDayClearXp(-1, FAKE_TUNING)).toBe(0);
  });
});

describe("streakDayXp — base + perTier × the streak's EFFECTIVE tier", () => {
  it("20 at tier 0, up through +5 per tier", () => {
    expect(streakDayXp(0, FAKE_TUNING)).toBe(20);
    expect(streakDayXp(1, FAKE_TUNING)).toBe(25);
    expect(streakDayXp(4, FAKE_TUNING)).toBe(40);
  });
});

describe("masteryTierXp — perTier × the NEW tier, never a sum of skipped tiers", () => {
  it("scales with the single new tier reached, not cumulatively", () => {
    expect(masteryTierXp(1, FAKE_TUNING)).toBe(25);
    expect(masteryTierXp(5, FAKE_TUNING)).toBe(125);
    // Jumping straight to tier 3 pays 3×25, NOT 1×25 + 2×25 + 3×25.
    expect(masteryTierXp(3, FAKE_TUNING)).toBe(75);
  });
});

describe("albumXpFromDeltas — three independent, additive channels", () => {
  it("sums seen/caught/variant deltas at their own rates", () => {
    expect(albumXpFromDeltas(1, 0, 0, FAKE_TUNING)).toBe(10);
    expect(albumXpFromDeltas(0, 1, 0, FAKE_TUNING)).toBe(50);
    expect(albumXpFromDeltas(0, 0, 1, FAKE_TUNING)).toBe(35);
    expect(albumXpFromDeltas(2, 1, 1, FAKE_TUNING)).toBe(2 * 10 + 50 + 35);
  });

  it("ignores negative deltas (Album totals are forward-only; this is defensive)", () => {
    expect(albumXpFromDeltas(-1, -1, -1, FAKE_TUNING)).toBe(0);
  });

  it("zero deltas grant zero — a dispatch that touched nothing pays nothing", () => {
    expect(albumXpFromDeltas(0, 0, 0, FAKE_TUNING)).toBe(0);
  });
});

describe("the level-curve helpers (bible §1.1/§1.2)", () => {
  it("xpRequiredForLevel: levelXp is 0-indexed by tier − 1", () => {
    expect(xpRequiredForLevel(1, FAKE_TUNING)).toBe(0);
    expect(xpRequiredForLevel(2, FAKE_TUNING)).toBe(100);
    expect(xpRequiredForLevel(4, FAKE_TUNING)).toBe(500);
    // Past the top of the table: no requirement recorded, defaults to 0
    // rather than throwing — callers treat "no next tier" separately.
    expect(xpRequiredForLevel(9, FAKE_TUNING)).toBe(0);
  });

  it("isNextTierXpReady: true once keepXp clears the NEXT tier's gate", () => {
    expect(isNextTierXpReady(99, 1, FAKE_TUNING)).toBe(false);
    expect(isNextTierXpReady(100, 1, FAKE_TUNING)).toBe(true);
    expect(isNextTierXpReady(1_000_000, 1, FAKE_TUNING)).toBe(true);
  });

  it("isNextTierXpReady: false past the last defined tier — nothing left to clear", () => {
    expect(isNextTierXpReady(1_000_000, 4, FAKE_TUNING)).toBe(false);
  });

  it("tierBarProgress: per-TIER, never cumulative — into/span reset each level", () => {
    // Tier 2 spans [100, 250) — 60 XP in is 60 of 150.
    expect(tierBarProgress(160, 2, FAKE_TUNING)).toEqual({ into: 60, span: 150 });
    // Exactly at the floor: 0 of the span.
    expect(tierBarProgress(100, 2, FAKE_TUNING)).toEqual({ into: 0, span: 150 });
    // Past the top tier: span collapses to 0 (nothing left to fill from
    // this table — Renown owns what happens next, bible §1.7). `into`
    // keeps reporting the raw overflow; callers treat `span === 0` as
    // "read the bar as full" rather than dividing by it.
    expect(tierBarProgress(9_999, 4, FAKE_TUNING)).toEqual({ into: 9_499, span: 0 });
  });

  it("the REAL levelXp table is strictly increasing (a future retune must fail here first)", () => {
    const levelXp = contentTuning.progression.levelXp;
    for (let i = 1; i < levelXp.length; i++) {
      expect(levelXp[i], `levelXp[${i}] vs [${i - 1}]`).toBeGreaterThan(
        levelXp[i - 1] as number,
      );
    }
  });
});

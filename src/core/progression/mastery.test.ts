import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import {
  incrementMasteryTrips,
  masteryBonusRollChance,
  masteryEggChanceBonusPoints,
  masteryTier,
  masteryTitle,
  maxMasteryTier,
  tripsForTier,
} from "./mastery";

describe("tripsForTier — time-normalised thresholds", () => {
  it("matches the bible's Meadow ladder (5 min): 6/18/48/108/216", () => {
    const durationMs = 5 * 60_000;
    expect(tripsForTier(1, durationMs, contentTuning)).toBe(6);
    expect(tripsForTier(2, durationMs, contentTuning)).toBe(18);
    expect(tripsForTier(3, durationMs, contentTuning)).toBe(48);
    expect(tripsForTier(4, durationMs, contentTuning)).toBe(108);
    expect(tripsForTier(5, durationMs, contentTuning)).toBe(216);
  });

  it("matches the bible's Lanterngrotto ladder (90 min): 2/4/7/12/20", () => {
    const durationMs = 90 * 60_000;
    expect(tripsForTier(1, durationMs, contentTuning)).toBe(2);
    expect(tripsForTier(2, durationMs, contentTuning)).toBe(4);
    expect(tripsForTier(3, durationMs, contentTuning)).toBe(7);
    expect(tripsForTier(4, durationMs, contentTuning)).toBe(12);
    expect(tripsForTier(5, durationMs, contentTuning)).toBe(20);
  });

  it("the tierMinTrips floor stops a long biome handing out tier 1 for one trip", () => {
    // A hypothetical 10-hour expedition: 0.5h*60/600min rounds to under 1,
    // so the floor (tierMinTrips[0] = 2) must win.
    const durationMs = 10 * 60 * 60_000;
    expect(tripsForTier(1, durationMs, contentTuning)).toBe(2);
  });
});

describe("masteryTier — derived, monotonic, never negative", () => {
  const meadowMs = 5 * 60_000;

  it("is 0 below tier 1's threshold", () => {
    expect(masteryTier(0, meadowMs, contentTuning)).toBe(0);
    expect(masteryTier(5, meadowMs, contentTuning)).toBe(0);
  });

  it("climbs exactly at each threshold", () => {
    expect(masteryTier(6, meadowMs, contentTuning)).toBe(1);
    expect(masteryTier(17, meadowMs, contentTuning)).toBe(1);
    expect(masteryTier(18, meadowMs, contentTuning)).toBe(2);
    expect(masteryTier(216, meadowMs, contentTuning)).toBe(5);
    expect(masteryTier(10_000, meadowMs, contentTuning)).toBe(5); // never above max
  });

  it("retuning thresholds re-grades every Pip with no migration (pure function of trips)", () => {
    const looserTuning = {
      retention: {
        mastery: {
          ...contentTuning.retention.mastery,
          tierMinTrips: [1, 1, 1, 1, 1],
        },
      },
    };
    // Same trip count, different tier under different tuning — no stored
    // tier anywhere, so there is nothing to migrate.
    expect(masteryTier(6, meadowMs, contentTuning)).toBe(1);
    expect(masteryTier(6, meadowMs, looserTuning)).toBeGreaterThanOrEqual(1);
  });
});

describe("bonus effects — loot quantity + top-tier egg points only", () => {
  const meadowMs = 5 * 60_000;

  it("is 0 below tier 1", () => {
    expect(masteryBonusRollChance(0, meadowMs, contentTuning)).toBe(0);
    expect(masteryEggChanceBonusPoints(0, meadowMs, contentTuning)).toBe(0);
  });

  it("matches the tuning table per tier", () => {
    expect(masteryBonusRollChance(6, meadowMs, contentTuning)).toBeCloseTo(0.02);
    expect(masteryBonusRollChance(18, meadowMs, contentTuning)).toBeCloseTo(0.05);
    expect(masteryBonusRollChance(216, meadowMs, contentTuning)).toBeCloseTo(0.15);
  });

  it("egg-chance bonus points are 0 until the TOP tier, then match tuning", () => {
    expect(masteryEggChanceBonusPoints(108, meadowMs, contentTuning)).toBe(0);
    expect(masteryEggChanceBonusPoints(216, meadowMs, contentTuning)).toBeCloseTo(
      contentTuning.retention.mastery.topTierEggChanceBonusPoints,
    );
  });

  it("caps at the max tier defined by tuning", () => {
    expect(maxMasteryTier(contentTuning)).toBe(5);
  });
});

describe("incrementMasteryTrips — forward-only, per-biome, undefined ≡ {}", () => {
  it("starts a fresh biome entry at 1 from undefined mastery", () => {
    const next = incrementMasteryTrips(undefined, "meadow");
    expect(next).toEqual({ meadow: 1 });
  });

  it("increments only the named biome, leaving others untouched", () => {
    const start = { meadow: 3, forest: 1 };
    const next = incrementMasteryTrips(start, "meadow");
    expect(next).toEqual({ meadow: 4, forest: 1 });
    // Original untouched (pure).
    expect(start).toEqual({ meadow: 3, forest: 1 });
  });

  it("never decreases across a long randomised sequence (survives retire/retrieve/evolution by construction — it's plain data on PipState)", () => {
    let mastery: Readonly<Record<string, number>> | undefined = undefined;
    const biomes = ["meadow", "forest", "shore"];
    let totals: Record<string, number> = { meadow: 0, forest: 0, shore: 0 };
    for (let i = 0; i < 200; i++) {
      const biome = biomes[i % biomes.length] as string;
      mastery = incrementMasteryTrips(mastery, biome);
      totals[biome] = (totals[biome] ?? 0) + 1;
      for (const b of biomes) {
        expect(mastery[b] ?? 0).toBe(totals[b] ?? 0);
      }
    }
  });
});

describe("masteryTitle — the actual reward", () => {
  it("has no title at tier 0", () => {
    expect(masteryTitle(0, "Meadow")).toBeNull();
  });

  it("names the biome only at the top tier", () => {
    expect(masteryTitle(1, "Meadow")).toBe("Knows the path");
    expect(masteryTitle(5, "Meadow")).toBe("Old friend of the Meadow");
    expect(masteryTitle(5, "Lanterngrotto")).toBe("Old friend of the Lanterngrotto");
  });
});

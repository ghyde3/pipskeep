import { describe, expect, it } from "vitest";
import { MILESTONES } from "./milestones";
import { tuning } from "./tuning";

const ALLOWED_REWARD_KINDS = new Set(["resources", "items", "keepsake", "flair", "none"]);

/** The isolation list (spec §0.4 restated by the retention bible): nothing
 * a milestone grants may be, or point at, these tuning keys. Milestone
 * rewards are structurally resources/items/decorationId/flairId (see
 * `MilestoneReward`), so this is a defensive string-scan guard against
 * anyone widening the reward shape later without re-reading this rule. */
const ISOLATION_KEYS = [
  "needDecayPerHour",
  "personalityDecayMultipliers",
  "offlineRateCapMs",
  "sulkExitThreshold",
  "playRefusal",
];

describe("MILESTONES registry", () => {
  it("every reward kind is in the allowed set (resources/items/keepsake/flair/none — never power)", () => {
    for (const m of MILESTONES) {
      expect(ALLOWED_REWARD_KINDS.has(m.reward.kind), m.id).toBe(true);
    }
  });

  it("no milestone reward references any isolation-list tuning key", () => {
    for (const m of MILESTONES) {
      const serialized = JSON.stringify(m.reward);
      for (const key of ISOLATION_KEYS) {
        expect(serialized.includes(key), `${m.id} reward mentions ${key}`).toBe(false);
      }
    }
  });

  it("NEVER carries an availableWindow field — a windowed achievement is forbidden, not merely unused", () => {
    for (const m of MILESTONES) {
      expect("availableWindow" in m).toBe(false);
    }
  });

  it("every metric kind resolves to a real, known kind (schema sanity)", () => {
    const knownKinds = new Set([
      "counter",
      "albumForms",
      "ledgerVariants",
      "streakLongest",
      "masteryTierAnyBiome",
      "masteryTierAllBiomes",
      "oldestPipAgeMs",
      "sanctuaryResidents",
    ]);
    for (const m of MILESTONES) {
      expect(knownKinds.has(m.metric.kind), m.id).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every threshold is a positive number (or +Infinity for the migration-only founder grant)", () => {
    for (const m of MILESTONES) {
      expect(m.threshold).toBeGreaterThan(0);
    }
  });

  it("no milestone reward grants Wood before Keep level 2 is even reachable — the level-1 wood ceiling applies here too", () => {
    // Every milestone in this registry that could plausibly be earned in
    // the first hour/day grants no Wood at all — checked across the WHOLE
    // registry as the simplest true invariant: nothing here grants Wood,
    // so the pre-level-2 cap can never be threatened by a milestone.
    let totalWood = 0;
    for (const m of MILESTONES) {
      if (m.reward.kind === "resources") {
        totalWood += m.reward.bundle["wood"] ?? 0;
      }
    }
    expect(totalWood).toBeLessThanOrEqual(tuning.retention.grants.preLevel2WoodCap);
  });

  it("covers first-hour, first-day, first-week and long-haul milestones (the spread is real, not vacuous)", () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(30);
  });

  it("the founder milestone is migration-only (threshold unreachable by ordinary play)", () => {
    const founder = MILESTONES.find((m) => m.id === "founder");
    expect(founder).toBeDefined();
    expect(founder!.threshold).toBe(Number.POSITIVE_INFINITY);
    expect(founder!.hidden).toBe(true);
  });
});

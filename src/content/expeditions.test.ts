/**
 * Expedition registry tests (content bible §2, §3.6). `core/expeditions`'s
 * own test suite covers the STATE MACHINE (assignment, timers, loot
 * rolling); `core/economy/reachability.test.ts` covers the ECONOMY (every
 * gated cost payable from the previous tier). This file is the CONTENT
 * shape guard round 2B needed and the shipped suite had a gap for:
 *
 *   - every expedition's `eggSpecies` pool (new field, bible §3.6)
 *     references real species ids — nothing else in the repo checked this,
 *     because the field did not exist before this round;
 *   - every loot item referenced anywhere resolves against a real
 *     registry (RESOURCE_IDS ∪ tuning.foods — the same oracle
 *     `reachability.test.ts` uses, restated here as a content-only
 *     signature that does not need the full economy harness);
 *   - the six-biome shape itself (quick trip / deep trip per tier) holds
 *     the invariants the bible states in prose: shorter duration, lower
 *     egg chance, and more raw items/minute than its tier's deep trip.
 *
 * `content/validate.ts` intentionally stays generic (it does not know
 * about `eggSpecies` — a bespoke field on one registry); this file is
 * where that specific new shape gets its guard instead.
 */

import { describe, expect, it } from "vitest";
import { RESOURCE_IDS } from "../core/economy";
import { EXPEDITION_IDS, expeditions } from "./expeditions";
import { species } from "./species";
import { tuning } from "./tuning";

const KNOWN_ITEM_IDS = new Set<string>([
  ...RESOURCE_IDS,
  ...Object.keys(tuning.foods),
]);

/** Per-trip expected count of `itemId` from `expeditionId`'s loot table. */
function perTrip(expeditionId: (typeof EXPEDITION_IDS)[number], itemId: string): number {
  const expedition = expeditions[expeditionId];
  const weightSum = expedition.lootTable.reduce((sum, e) => sum + e.weight, 0);
  const entry = expedition.lootTable.find((row) => row.itemId === itemId);
  return entry === undefined ? 0 : expedition.lootRolls * (entry.weight / weightSum);
}

/** Per-WALL-CLOCK-MINUTE expected count of `itemId` from `expeditionId`. */
function perMinute(expeditionId: (typeof EXPEDITION_IDS)[number], itemId: string): number {
  return perTrip(expeditionId, itemId) / (expeditions[expeditionId].durationMs / 60_000);
}

/** Raw items per minute, regardless of which item — the "quick trips are
 * the active-play reward" measure (content bible §2.1). */
function itemsPerMinute(expeditionId: (typeof EXPEDITION_IDS)[number]): number {
  return expeditions[expeditionId].lootRolls / (expeditions[expeditionId].durationMs / 60_000);
}

describe("expedition registry shape (content bible §2)", () => {
  it("ships exactly the six ids the bible specifies", () => {
    expect([...EXPEDITION_IDS].sort()).toEqual(
      ["meadow", "bramblewick", "forest", "snowdrift", "shore", "lanterngrotto"].sort(),
    );
    expect(Object.keys(expeditions).sort()).toEqual([...EXPEDITION_IDS].sort());
  });

  it("every registry entry's id matches its own key (no copy-paste id drift)", () => {
    for (const [key, def] of Object.entries(expeditions)) {
      expect(def.id, key).toBe(key);
    }
  });

  it("every loot item resolves against RESOURCE_IDS ∪ tuning.foods (the reachability oracle, restated)", () => {
    for (const expedition of Object.values(expeditions)) {
      for (const entry of expedition.lootTable) {
        expect(
          KNOWN_ITEM_IDS.has(entry.itemId),
          `expedition "${expedition.id}": unknown loot item "${entry.itemId}"`,
        ).toBe(true);
      }
    }
  });

  it("carries real, non-empty flavor text for every biome", () => {
    for (const expedition of Object.values(expeditions)) {
      expect(expedition.flavor.trim().length, expedition.id).toBeGreaterThan(10);
    }
  });
});

describe("the collection engine — eggSpecies pools (content bible §3.6)", () => {
  const EXPECTED_POOLS: Readonly<Record<(typeof EXPEDITION_IDS)[number], readonly string[]>> = {
    meadow: ["mosspip", "cloudpip"],
    bramblewick: ["mosspip", "pebblepip"],
    forest: ["mosspip", "pebblepip", "emberpip"],
    snowdrift: ["snowpip", "cloudpip"],
    shore: ["tidepip", "cloudpip"],
    lanterngrotto: ["emberpip", "lanternpip"],
  };

  it("every expedition defines the exact pool the bible's table specifies", () => {
    for (const id of EXPEDITION_IDS) {
      expect(expeditions[id].eggSpecies, id).toEqual(EXPECTED_POOLS[id]);
    }
  });

  it("every eggSpecies pool is non-empty and references a real species id (the gap this file exists to close)", () => {
    for (const expedition of Object.values(expeditions)) {
      const pool = expedition.eggSpecies;
      expect(pool, expedition.id).toBeDefined();
      expect(pool!.length, expedition.id).toBeGreaterThan(0);
      for (const speciesId of pool!) {
        expect(
          speciesId in species,
          `expedition "${expedition.id}": eggSpecies references unknown species "${speciesId}"`,
        ).toBe(true);
      }
    }
  });

  it("Lanternpip, Snowpip and Tidepip each have exactly ONE door — the trophy-chase shape (bible §3.6)", () => {
    const poolsContaining = (target: string): string[] =>
      Object.values(expeditions)
        .filter((e) => e.eggSpecies?.includes(target))
        .map((e) => e.id);

    expect(poolsContaining("lanternpip")).toEqual(["lanterngrotto"]);
    expect(poolsContaining("snowpip")).toEqual(["snowdrift"]);
    expect(poolsContaining("tidepip")).toEqual(["shore"]);
  });
});

describe("the shape of the curve: quick trip vs deep trip, per tier (content bible §2.1)", () => {
  const TIERS: readonly {
    readonly quick: (typeof EXPEDITION_IDS)[number];
    readonly deep: (typeof EXPEDITION_IDS)[number];
  }[] = [
    { quick: "meadow", deep: "bramblewick" },
    { quick: "forest", deep: "snowdrift" },
    { quick: "shore", deep: "lanterngrotto" },
  ];

  for (const { quick, deep } of TIERS) {
    it(`${quick} < ${deep}: deep trip is longer and has a higher PER-TRIP egg chance`, () => {
      expect(expeditions[deep].durationMs).toBeGreaterThan(expeditions[quick].durationMs);
      expect(expeditions[deep].eggChance).toBeGreaterThan(expeditions[quick].eggChance);
    });

    it(`${quick} > ${deep}: the quick trip still wins on raw items per minute (the active-play reward)`, () => {
      expect(itemsPerMinute(quick)).toBeGreaterThan(itemsPerMinute(deep));
    });
  }

  // ROUND 2F (progression bible §2.1) — the six biomes RE-SPREAD across
  // the widened 12-tier ladder so a two-hour-old save no longer sees
  // every trail. Meadow/Bramblewick stay at tier 1 (untouched — load-
  // bearing for the level-1 wood ceiling and the 30–45 minute level-2
  // target); Forest/Snowdrift and Shore/Lanterngrotto no longer share a
  // tier with their quick-trip partner.
  it("the six biomes unlock across the new spread: 1, 1, 2, 3, 4, 5", () => {
    expect(expeditions.meadow.unlockKeepLevel).toBe(1);
    expect(expeditions.bramblewick.unlockKeepLevel).toBe(1);
    expect(expeditions.forest.unlockKeepLevel).toBe(2);
    expect(expeditions.snowdrift.unlockKeepLevel).toBe(3);
    expect(expeditions.shore.unlockKeepLevel).toBe(4);
    expect(expeditions.lanterngrotto.unlockKeepLevel).toBe(5);
  });

  it("the level-1 wood ceiling: Bramblewick drops NO wood at all (bible §3.3)", () => {
    // The Meadow is the ONLY wood source at Keep level 1 by design — a new
    // level-1 expedition dropping wood would push the level-2 target below
    // its 15-minute floor (see tuning.ts's ceiling comment). Restated here
    // as a hard content assertion so it fails loudly, not just as a
    // confusing reachability-test minute-count regression.
    expect(perMinute("bramblewick", "wood")).toBe(0);
  });

  it("the level-1 fiber ceiling: Bramblewick stays comfortably under 0.400 fiber/min (bible §3.3)", () => {
    expect(perMinute("bramblewick", "fiber")).toBeLessThan(0.4);
    // ...and behind the Meadow's own fiber rate, so wood stays the binding
    // resource for the level-2 target.
    expect(perMinute("bramblewick", "fiber")).toBeLessThan(perMinute("meadow", "fiber"));
  });

  it("Forest still beats Meadow on wood, per minute (round 2A's fix, unmoved by this round)", () => {
    expect(perMinute("forest", "wood")).toBeGreaterThan(perMinute("meadow", "wood"));
  });

  it("the Shore edit (bible §2.2): shell/min unchanged, driftwood/min falls but stays well clear of zero", () => {
    expect(perMinute("shore", "shell")).toBeCloseTo(0.09, 5);
    expect(perMinute("shore", "driftwood")).toBeCloseTo(0.06, 5);
    expect(perMinute("shore", "driftwood")).toBeGreaterThan(0);
  });

  it("Lanterngrotto's Feastpot lands about once every 3–4 trips, the intended rare-treat cadence (bible §2.2)", () => {
    const perTripChance = perTrip("lanterngrotto", "feastpot");
    expect(perTripChance).toBeGreaterThan(0.2);
    expect(perTripChance).toBeLessThan(0.4);
    expect(1 / perTripChance).toBeGreaterThan(3);
    expect(1 / perTripChance).toBeLessThan(4);
  });
});

/**
 * PROGRESSION REACHABILITY GUARD (playtest round 2A).
 *
 * The bug this file exists to make impossible:
 *
 *   Keep level 2 cost Wood. Wood dropped ONLY from the Forest. The Forest
 *   unlocked at Keep level 2. The game could not progress past level 1.
 *
 * (The same shape was hiding one level up: level 3 cost Shell + Driftwood,
 * which dropped ONLY from the Shore, which unlocked at level 3.)
 *
 * That is a whole CLASS of bug — "this tier's price is only payable with
 * the next tier's income" — and no amount of careful content authoring
 * prevents it by hand. So this file proves the invariant instead, and it
 * is written DATA-DRIVEN off the registries so future content is covered
 * automatically:
 *
 *   For every priced thing in the game, every resource in its cost must
 *   drop from an expedition that is ALREADY UNLOCKED when that thing
 *   becomes purchasable — and the expected yield of those expeditions
 *   must cover the price inside a sane play budget.
 *
 * Two layers, deliberately:
 *   1. STRUCTURAL — "is this resource obtainable at all yet?" This is the
 *      sharp one; it is what would have caught the shipped deadlock.
 *   2. RATE — "and can you actually afford it this decade?" Guards the
 *      softer failure where something is technically reachable at a 0.5%
 *      drop weight.
 *
 * Rolls go through the REAL `rollExpeditionLoot` against the REAL loot
 * tables, driven by the seeded RNG (spec §2 rule 3) — no hand-rolled
 * probability model that could drift from the shipped roller.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { expeditions } from "../../content/expeditions";
import { keepLevels, keepUpgrades } from "../../content/keep";
import { placeables } from "../../content/placeables";
import { decorations } from "../../content/decorations";
import { jobs } from "../../content/jobs";
import { createRng } from "../rng";
import { rollExpeditionLoot } from "../expeditions";
import type { ExpeditionView } from "../expeditions";
import { RESOURCE_IDS, canAfford } from "./index";
import type { ResourceBundle, ResourceCounts } from "./index";

/**
 * How long a player is assumed to be willing to run expeditions for a
 * single purchase. Generous on purpose: this layer is a "can you EVER
 * afford this" guard, not the feel target. The 45-minute owner target for
 * Keep level 2 gets its own, much tighter test below.
 */
const REACHABILITY_BUDGET_MS = 3 * HOUR_MS;

/** The owner's stated target for the first Keep upgrade (round 2A). */
const ENGAGED_SESSION_MS = 45 * MINUTE_MS;

/** Seeded sessions per simulated claim. Fixed seeds → deterministic. */
const SESSIONS = 200;

/** Loot rolls carry no personality quirk here: the guarantee must hold
 * for the plainest possible Pip, never leaning on Curious's bonus. */
const NO_QUIRK_PERSONALITY = "";

const RESOURCE_SET: ReadonlySet<string> = new Set<string>(RESOURCE_IDS);

/** Highest Keep level the registry defines. */
const MAX_LEVEL = Math.max(...keepLevels.map((entry) => entry.level));

const expeditionList: readonly ExpeditionView[] = Object.values(expeditions);

/** Every expedition a player at `level` can already send a Pip on. */
function unlockedAt(level: number): readonly ExpeditionView[] {
  return expeditionList.filter(
    (expedition) => expedition.unlockKeepLevel <= level,
  );
}

/** Resource ids with a positive drop weight in ANY expedition unlocked at
 * `level`. Jobs are deliberately excluded — a job needs a station, and a
 * station has a cost of its own, so counting jobs here would let a
 * circular economy prove itself. Job tables get their own check below. */
function resourcesObtainableAt(level: number): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const expedition of unlockedAt(level)) {
    for (const entry of expedition.lootTable) {
      if (entry.weight > 0 && RESOURCE_SET.has(entry.itemId)) {
        ids.add(entry.itemId);
      }
    }
  }
  return ids;
}

/** Resource ids named in a cost bundle with a non-zero amount. */
function costedResources(cost: ResourceBundle): readonly string[] {
  return Object.entries(cost)
    .filter(([, amount]) => amount !== undefined && amount > 0)
    .map(([resourceId]) => resourceId);
}

/** Analytic expected resource yield from running EVERY expedition
 * unlocked at `level` in parallel — one Pip each, back-to-back, for
 * `budgetMs` (spec §6.1: one Pip per expedition, so trips of the same
 * expedition are serial but different expeditions run concurrently). */
function expectedYieldAt(level: number, budgetMs: number): ResourceCounts {
  const totals: Record<string, number> = {};
  for (const expedition of unlockedAt(level)) {
    const runs = Math.floor(budgetMs / expedition.durationMs);
    const weightSum = expedition.lootTable.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    if (weightSum <= 0) continue;
    for (const entry of expedition.lootTable) {
      if (!RESOURCE_SET.has(entry.itemId)) continue;
      totals[entry.itemId] =
        (totals[entry.itemId] ?? 0) +
        runs * expedition.lootRolls * (entry.weight / weightSum);
    }
  }
  return totals;
}

/** One simulated play session: run every unlocked expedition back-to-back
 * for `budgetMs` against the seeded loot tables and bank the resources
 * (foods route to the inventory in the real game and are not currency). */
function simulateSessionAt(
  level: number,
  budgetMs: number,
  seed: number,
): ResourceCounts {
  const rng = createRng(seed);
  const stream = rng.stream("expedition-loot");
  const totals: Record<string, number> = {};
  for (const expedition of unlockedAt(level)) {
    const runs = Math.floor(budgetMs / expedition.durationMs);
    for (let run = 0; run < runs; run++) {
      const loot = rollExpeditionLoot(
        stream,
        expedition,
        NO_QUIRK_PERSONALITY,
        tuning,
      );
      for (const itemId of loot.items) {
        if (!RESOURCE_SET.has(itemId)) continue;
        totals[itemId] = (totals[itemId] ?? 0) + 1;
      }
    }
  }
  return totals;
}

/** Fraction of `SESSIONS` seeded sessions that can afford `cost`. */
function affordRate(
  level: number,
  budgetMs: number,
  cost: ResourceBundle,
): number {
  let afforded = 0;
  for (let seed = 1; seed <= SESSIONS; seed++) {
    if (canAfford(simulateSessionAt(level, budgetMs, seed), cost)) {
      afforded += 1;
    }
  }
  return afforded / SESSIONS;
}

/** Wall-clock minutes of engaged expedition running to afford `cost` at
 * `level`, from the analytic expectation. Infinity if unobtainable. */
function expectedMinutesToAfford(level: number, cost: ResourceBundle): number {
  let worst = 0;
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount === undefined || amount <= 0) continue;
    // Yield is linear in the budget, so one long probe gives the rate.
    const probeMs = 100 * HOUR_MS;
    const perProbe = expectedYieldAt(level, probeMs)[resourceId] ?? 0;
    if (perProbe <= 0) return Infinity;
    const ratePerMinute = perProbe / (probeMs / MINUTE_MS);
    worst = Math.max(worst, amount / ratePerMinute);
  }
  return worst;
}

/** Every priced thing in the game, tagged with the Keep level at which it
 * first becomes purchasable. Built from the registries, so new content is
 * covered without touching this file. */
interface PricedThing {
  readonly label: string;
  readonly cost: ResourceBundle;
  /** Level at which the player can first buy it. Its cost must be payable
   * from the expeditions unlocked at `availableFrom - 1` for Keep levels
   * (you buy level N with level N−1 income) and at `availableFrom` for
   * everything else (you buy it while standing at that level). */
  readonly payableAt: number;
}

const pricedKeepLevels: readonly PricedThing[] = keepLevels
  .filter((entry) => costedResources(entry.cost).length > 0)
  .map((entry) => ({
    label: `Keep level ${entry.level}`,
    cost: entry.cost,
    // The load-bearing rule: you must be able to pay for the NEXT level
    // using only what the CURRENT level lets you do.
    payableAt: entry.level - 1,
  }));

const pricedKeepUpgrades: readonly PricedThing[] = Object.values(
  keepUpgrades,
).map((upgrade) => ({
  label: `Keep upgrade "${upgrade.id}"`,
  cost: upgrade.cost,
  payableAt: upgrade.prerequisiteLevel,
}));

/**
 * ROUND 2F (docs/progression-bible.md §2.3/§8.3, "Update 1" — an
 * AUTHORISED TIGHTENING, not a weakening): placeables now gain their own
 * `unlockKeepLevel` on `content/placeables.ts`'s `PlaceableDef`, so each
 * station is checked against the income available when it actually
 * appears, rather than a blanket "must be payable at level 1". The four
 * shipped placeables are unaffected (`unlockKeepLevel: 1`, except the
 * Stockpot at 3 — its Wood/Fiber cost is payable at every tier anyway).
 * This is what makes a Shell/Driftwood-priced late station (Trail Post,
 * Beacon, Weathervane) possible at all without breaking this suite.
 */
const pricedPlaceables: readonly PricedThing[] = placeables.map((item) => ({
  label: `Placeable "${item.id}"`,
  cost: item.cost,
  payableAt: item.unlockKeepLevel,
}));

const allPricedThings: readonly PricedThing[] = [
  ...pricedKeepLevels,
  ...pricedKeepUpgrades,
  ...pricedPlaceables,
];

// ---------------------------------------------------------------------------

describe("the deadlock that shipped (regression pins)", () => {
  it("Wood is obtainable at Keep level 1", () => {
    expect([...resourcesObtainableAt(1)]).toContain("wood");
  });

  it("every resource Keep level 2 costs drops at Keep level 1", () => {
    const level2 = keepLevels.find((entry) => entry.level === 2);
    expect(level2).toBeDefined();
    const obtainable = resourcesObtainableAt(1);
    for (const resourceId of costedResources(level2!.cost)) {
      expect([...obtainable], `level 2 needs ${resourceId}`).toContain(
        resourceId,
      );
    }
  });

  it("every resource Keep level 3 costs drops at Keep level 2", () => {
    const level3 = keepLevels.find((entry) => entry.level === 3);
    expect(level3).toBeDefined();
    const obtainable = resourcesObtainableAt(2);
    for (const resourceId of costedResources(level3!.cost)) {
      expect([...obtainable], `level 3 needs ${resourceId}`).toContain(
        resourceId,
      );
    }
  });

  it("no Keep level is priced in a resource that only the level it unlocks can supply", () => {
    for (const entry of keepLevels) {
      const unlocked = new Set(
        unlockedAt(entry.level)
          .filter((expedition) => expedition.unlockKeepLevel === entry.level)
          .flatMap((expedition) =>
            expedition.lootTable.map((loot) => loot.itemId),
          ),
      );
      const obtainableBefore = resourcesObtainableAt(entry.level - 1);
      for (const resourceId of costedResources(entry.cost)) {
        if (!unlocked.has(resourceId)) continue;
        expect(
          [...obtainableBefore],
          `Keep level ${entry.level} is priced in ${resourceId}, which its OWN unlock supplies`,
        ).toContain(resourceId);
      }
    }
  });
});

describe("structural reachability: every price is payable with already-unlocked income", () => {
  for (const thing of allPricedThings) {
    it(`${thing.label} is priced only in resources obtainable at Keep level ${thing.payableAt}`, () => {
      expect(thing.payableAt).toBeGreaterThanOrEqual(1);
      const obtainable = resourcesObtainableAt(thing.payableAt);
      for (const resourceId of costedResources(thing.cost)) {
        expect(
          [...obtainable],
          `${thing.label} needs ${resourceId} at level ${thing.payableAt}`,
        ).toContain(resourceId);
      }
    });
  }

  it("covers every priced registry entry (the data-driven claim, not a hand-written list)", () => {
    expect(pricedKeepLevels.length).toBeGreaterThan(0);
    expect(pricedKeepUpgrades.length).toBeGreaterThan(0);
    expect(pricedPlaceables.length).toBe(placeables.length);
  });

  it("every decoration is buyable by the time the Keep is fully built", () => {
    const obtainable = resourcesObtainableAt(MAX_LEVEL);
    for (const decoration of decorations) {
      for (const resourceId of costedResources(decoration.cost)) {
        expect(
          [...obtainable],
          `decoration "${decoration.id}" needs ${resourceId}`,
        ).toContain(resourceId);
      }
    }
  });

  it("no expedition or job table drops a resource that does not exist", () => {
    const known = new Set<string>([
      ...RESOURCE_IDS,
      ...Object.keys(tuning.foods),
    ]);
    for (const expedition of expeditionList) {
      for (const entry of expedition.lootTable) {
        expect([...known], `expedition "${expedition.id}"`).toContain(
          entry.itemId,
        );
      }
    }
    for (const job of Object.values(jobs)) {
      for (const entry of job.table) {
        expect([...known], `job "${job.id}"`).toContain(entry.itemId);
      }
    }
  });

  it("a station's own cost is payable at level 1, so the job economy is not circular", () => {
    const obtainable = resourcesObtainableAt(1);
    for (const job of Object.values(jobs)) {
      const station = placeables.find((item) => item.id === job.stationItemId);
      expect(station, `job "${job.id}" has no station placeable`).toBeDefined();
      for (const resourceId of costedResources(station!.cost)) {
        expect(
          [...obtainable],
          `station "${station!.id}" needs ${resourceId}`,
        ).toContain(resourceId);
      }
    }
  });
});

describe("rate reachability: expected yield covers the price inside a sane budget", () => {
  for (const thing of allPricedThings) {
    it(`${thing.label} is affordable after 3h of expeditions at Keep level ${thing.payableAt}`, () => {
      const expected = expectedYieldAt(thing.payableAt, REACHABILITY_BUDGET_MS);
      for (const [resourceId, amount] of Object.entries(thing.cost)) {
        if (amount === undefined || amount <= 0) continue;
        expect(
          expected[resourceId] ?? 0,
          `${thing.label}: expected ${resourceId} in 3h at level ${thing.payableAt}`,
        ).toBeGreaterThanOrEqual(amount);
      }
    });
  }

  for (const thing of allPricedThings) {
    it(`${thing.label}: a real seeded 3h session actually affords it`, () => {
      expect(
        affordRate(thing.payableAt, REACHABILITY_BUDGET_MS, thing.cost),
        `${thing.label} afford rate`,
      ).toBeGreaterThanOrEqual(0.95);
    });
  }
});

describe("the feel target: Keep level 2 in one engaged session", () => {
  const level2 = keepLevels.find((entry) => entry.level === 2)!;

  it("expects to be affordable in 30–45 minutes of back-to-back Meadow runs", () => {
    const minutes = expectedMinutesToAfford(1, level2.cost);
    expect(minutes).toBeLessThanOrEqual(45);
    // ...and not so cheap that the first upgrade is handed over for free.
    expect(minutes).toBeGreaterThanOrEqual(15);
  });

  it("most seeded 45-minute sessions actually get there", () => {
    expect(affordRate(1, ENGAGED_SESSION_MS, level2.cost)).toBeGreaterThan(0.5);
  });

  it("the casual on-ramp actually EXISTS: the Gathering Station is cheaper than the level it funds", () => {
    // ROUND 2B (playtest review). The station is advertised — in
    // tuning.ts and in this file's next test — as the casual player's
    // route to Keep level 2: build it, go away, come back to a fund. It
    // shipped costing 8 Wood against level 2's 5, so the "cheap route"
    // was strictly more expensive than the destination and no casual
    // player could ever take it. Two prices in a relationship, tested.
    const station = placeables.find((item) => item.id === "gathering-station");
    expect(station).toBeDefined();

    for (const [resourceId, amount] of Object.entries(station!.cost)) {
      if (amount === undefined || amount <= 0) continue;
      const levelAmount = level2.cost[resourceId as keyof ResourceBundle] ?? 0;
      expect(
        amount,
        `station needs more ${resourceId} than Keep level 2 does`,
      ).toBeLessThanOrEqual(levelAmount);
    }

    // ...and cheaper in the only unit the player feels: minutes played.
    const stationMinutes = expectedMinutesToAfford(1, station!.cost);
    const levelMinutes = expectedMinutesToAfford(1, level2.cost);
    expect(stationMinutes).toBeLessThan(levelMinutes);
    // Comfortably first, not marginally — it has to land inside the same
    // first session that would otherwise end at the upgrade.
    expect(stationMinutes).toBeLessThanOrEqual(0.7 * levelMinutes);
    expect(stationMinutes).toBeLessThanOrEqual(25);
  });

  it("stays reachable for the casual player: the Gathering Station alone gets there overnight", () => {
    const gathering = jobs["gathering"]!;
    const weightSum = gathering.table.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    // Offline production is a RATE and obeys the §4.5 cap, so one absence
    // yields at most this many ticks no matter how long the player is away.
    const ticks = Math.floor(tuning.offlineRateCapMs / gathering.intervalMs);
    for (const [resourceId, amount] of Object.entries(level2.cost)) {
      if (amount === undefined || amount <= 0) continue;
      const entry = gathering.table.find((row) => row.itemId === resourceId);
      expect(
        entry,
        `Gathering cannot produce ${resourceId} at all`,
      ).toBeDefined();
      const expected = ticks * (entry!.weight / weightSum);
      expect(
        expected,
        `Gathering yield of ${resourceId} over one capped absence`,
      ).toBeGreaterThanOrEqual(amount);
    }
  });

  it("escalates: each Keep level costs more engaged play than the last", () => {
    const minutesByLevel = keepLevels
      .filter((entry) => costedResources(entry.cost).length > 0)
      .map((entry) => ({
        level: entry.level,
        minutes: expectedMinutesToAfford(entry.level - 1, entry.cost),
      }))
      .sort((a, b) => a.level - b.level);

    for (let i = 1; i < minutesByLevel.length; i++) {
      expect(
        minutesByLevel[i]!.minutes,
        `Keep level ${minutesByLevel[i]!.level} vs ${minutesByLevel[i - 1]!.level}`,
      ).toBeGreaterThan(minutesByLevel[i - 1]!.minutes);
    }
  });
});

describe("the daily ritual is affordable (round 2B)", () => {
  /** Expected Berries from one trip of `expeditionId`. */
  const berriesPerTrip = (expeditionId: keyof typeof expeditions): number => {
    const expedition = expeditions[expeditionId];
    const weightSum = expedition.lootTable.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    const entry = expedition.lootTable.find((row) => row.itemId === "berry");
    return entry === undefined
      ? 0
      : expedition.lootRolls * (entry.weight / weightSum);
  };

  /** Round 2B priced a day of Hunger at two Berries per Pip (see
   * tuning.foods): the care loop only closes if the pantry can keep up. */
  const BERRIES_PER_PIP_PER_DAY = 2;
  const dailyBerries = BERRIES_PER_PIP_PER_DAY * tuning.rosterCap;

  it("a full roster's daily feeding is under 30 minutes of Meadow trips", () => {
    const perMinute =
      berriesPerTrip("meadow") /
      (expeditions.meadow.durationMs / MINUTE_MS);
    expect(perMinute).toBeGreaterThan(0);
    expect(dailyBerries / perMinute).toBeLessThanOrEqual(30);
  });

  it("...and one Gathering absence covers it many times over", () => {
    const gathering = jobs["gathering"]!;
    const weightSum = gathering.table.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    const ticks = Math.floor(tuning.offlineRateCapMs / gathering.intervalMs);
    const entry = gathering.table.find((row) => row.itemId === "berry");
    expect(entry, "Gathering produces no Berries").toBeDefined();
    expect(ticks * (entry!.weight / weightSum)).toBeGreaterThanOrEqual(
      dailyBerries,
    );
  });

  it("the guided first Feed still lands: the starter's 3 Berries are a real head start", () => {
    // A fresh save seeds 3 Berries against a starter at Hunger 60 (spec
    // §10.1). One Berry has to visibly move that bar without trivialising
    // the pantry, and the seed has to cover more than a single tap.
    expect(tuning.startingInventory["berry"]).toBeGreaterThanOrEqual(
      BERRIES_PER_PIP_PER_DAY,
    );
    expect(tuning.foods.berry.hunger).toBeGreaterThanOrEqual(25);
    expect(tuning.foods.berry.hunger).toBeLessThan(100);
  });
});

describe("progression shape (invariants the content must keep)", () => {
  it("every expedition beyond the first is a better source of its headline resource, per trip, than the tier below", () => {
    // The Forest must remain the Wood expedition even though the Meadow
    // now drops fallen twigs — otherwise the unlock reads as a downgrade.
    const perTrip = (expedition: ExpeditionView, itemId: string): number => {
      const weightSum = expedition.lootTable.reduce(
        (sum, entry) => sum + entry.weight,
        0,
      );
      const entry = expedition.lootTable.find((row) => row.itemId === itemId);
      return entry === undefined
        ? 0
        : expedition.lootRolls * (entry.weight / weightSum);
    };
    const meadow = expeditions.meadow;
    const forest = expeditions.forest;
    expect(perTrip(forest, "wood")).toBeGreaterThan(perTrip(meadow, "wood"));
  });

  it("...and beats it per MINUTE too, so the unlock is never a downgrade", () => {
    // ROUND 2B (playtest review). Per TRIP was the wrong unit: a Forest
    // trip takes three Meadow trips' worth of time, so at 4 rolls the
    // Forest paid 0.12 Wood/min against the Meadow's 0.15 and the fastest
    // route to the Wood-priced level 3 the Forest gates was to ignore the
    // Forest. An unlock the optimal player declines is not an unlock.
    const perMinute = (expedition: ExpeditionView, itemId: string): number => {
      const weightSum = expedition.lootTable.reduce(
        (sum, entry) => sum + entry.weight,
        0,
      );
      const entry = expedition.lootTable.find((row) => row.itemId === itemId);
      if (entry === undefined) return 0;
      return (
        (expedition.lootRolls * (entry.weight / weightSum)) /
        (expedition.durationMs / MINUTE_MS)
      );
    };
    expect(perMinute(expeditions.forest, "wood")).toBeGreaterThan(
      perMinute(expeditions.meadow, "wood"),
    );
    // The tier below still wins on RAW items per minute, though — short
    // trips are the active-play reward and must stay the busier loop.
    const itemsPerMinute = (expedition: ExpeditionView): number =>
      expedition.lootRolls / (expedition.durationMs / MINUTE_MS);
    expect(itemsPerMinute(expeditions.meadow)).toBeGreaterThan(
      itemsPerMinute(expeditions.forest),
    );
  });

  it("every Keep level's unlock list is worth the price: each level unlocks at least one expedition or upgrade", () => {
    for (const entry of keepLevels) {
      expect(entry.unlocks.length).toBeGreaterThan(0);
    }
  });

  it("every resource the game defines actually drops somewhere", () => {
    const everywhere = resourcesObtainableAt(MAX_LEVEL);
    for (const resourceId of RESOURCE_IDS) {
      expect([...everywhere], `${resourceId} is unobtainable`).toContain(
        resourceId,
      );
    }
  });
});

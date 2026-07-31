/**
 * ⚠️ ROUND 2K FIX STAGE — THE CALL-SITE GUARD.
 *
 * `attractions.test.ts` exercises `processAttractionVisits`/
 * `settleAttractionVisits` directly, with hand-built test content. That is
 * the right way to test the mechanics, and it is exactly why the round's
 * worst defect got through: BOTH real call sites in `core/state.ts` omitted
 * the `content` argument, so `content.accessoryIds` was `undefined`,
 * `rollFreshVisitor` fell back to `[]`, and `pickAccessory` returned `null`
 * for every visitor ever produced — while an egg-hatched Pip (which passes
 * `ACCESSORY_ROLL_POOL` explicitly) wore one 75% of the time. Sixteen
 * accessories in the pool, zero on any visitor. A mutation stage proved it
 * survived the whole suite.
 *
 * The lesson, which is round 2I's `pushWiring.test.ts` lesson again: a
 * module test proves the FUNCTION is right; only a call-site test proves the
 * WIRING is right. Everything here therefore goes through `reduce` with the
 * REAL shipped content — no injected registries, no injected tuning — so it
 * fails if a future refactor drops an argument again.
 */

import { describe, expect, it } from "vitest";
import { createNewGame, rootReducer } from "../state";
import type { GameState } from "../state";
import { ACCESSORY_ROLL_POOL, NO_ACCESSORY_ID } from "../../content/accessories";
import { tuning } from "../../content/tuning";
import { visitorIsPresent } from "./index";

const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

/** The six shipped attraction stations, in `content/placeables.ts` order. */
const REAL_ATTRACTIONS = [
  "clover-ring",
  "thicket-feeder",
  "sap-bucket",
  "snow-bell",
  "tidewrack",
  "lampwell",
] as const;

/**
 * A real game with `count` real attraction stations placed, every one
 * stocked full and overdue by `overdueBy`. Deliberately built by writing
 * the same fields the Build sheet writes, so the state is one a player
 * could actually reach.
 */
function keepWithAttractions(count: number, seed: number, overdueBy = 7 * HOUR): GameState {
  const base = createNewGame(seed, T0);
  const placements: Record<string, { itemId: string; x: number; y: number }> = {};
  const stock: Record<string, number> = {};
  const schedule: Record<string, number> = {};
  REAL_ATTRACTIONS.slice(0, count).forEach((itemId, i) => {
    const id = `place-${i + 1}`;
    placements[id] = { itemId, x: i * 3, y: 0 };
    stock[id] = tuning.attractions.stockMax;
    schedule[id] = T0 - overdueBy;
  });
  return {
    ...base,
    keep: { ...base.keep, level: tuning.attractions.unlockKeepLevel, placements },
    attractionStock: stock,
    attractionSchedule: schedule,
    visitors: {},
    lastTickAt: T0,
  };
}

function visitorsAfterTick(state: GameState, at = T0): GameState {
  return rootReducer(state, { type: "TICK", at });
}

describe("the live call site actually dresses its visitors (the shipped blocker)", () => {
  it("draws accessories from the REAL pool — not every visitor bare", () => {
    const drawn: (string | null)[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = visitorsAfterTick(keepWithAttractions(1, seed));
      const record = next.visitors?.["place-1"];
      expect(record, `seed ${seed} produced no visitor at all`).toBeDefined();
      drawn.push(record?.genome.accessoryId ?? null);
    }

    // THE ASSERTION THE SHIPPED SUITE NEVER MADE. The old test hand-set
    // `accessoryId: null` in its own fixture and then asserted it was
    // `null` — it round-tripped the fixture and proved nothing about the
    // roll. `null` is a legitimate OUTCOME (`NO_ACCESSORY_ID` is 4 of the
    // 16 pool entries, so ~25% of Pips are deliberately bare); what may
    // never happen is that it is the ONLY outcome.
    const worn = drawn.filter((id): id is string => id !== null);
    expect(worn.length, "every visitor across 40 seeds came out bare").toBeGreaterThan(0);

    // …and every one drawn is a real pool member, never an invented id.
    for (const id of worn) expect(ACCESSORY_ROLL_POOL).toContain(id);

    // Sanity on the pool itself, so this suite cannot pass vacuously if
    // someone empties `ACCESSORY_ROLL_POOL`.
    expect(new Set(ACCESSORY_ROLL_POOL).size).toBeGreaterThan(4);
    expect(ACCESSORY_ROLL_POOL).toContain(NO_ACCESSORY_ID);
  });

  it("gives a visitor a real INDIVIDUAL name, never its species id", () => {
    // Round 2D's regression, pinned at the point of materialisation rather
    // than only at welcome time: dropping `rollPipName` used to be caught
    // solely by NAME_STREAM cursor arithmetic, which notices the missing
    // roll but not that the visitor ended up called "mosspip".
    for (let seed = 1; seed <= 12; seed += 1) {
      const record = visitorsAfterTick(keepWithAttractions(1, seed)).visitors?.["place-1"];
      expect(record).toBeDefined();
      expect(record?.name).not.toBe(record?.speciesId);
      expect((record?.name ?? "").length).toBeGreaterThan(1);
    }
  });
});

describe("the catch-up call site dresses its visitors too", () => {
  it("a visitor materialised while the player was away is not bare", () => {
    const drawn: (string | null)[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = keepWithAttractions(1, seed, 0);
      const next = rootReducer(state, { type: "CATCHUP", savedAt: T0, now: T0 + 12 * HOUR });
      const record = next.visitors?.["place-1"];
      if (record === undefined) continue;
      drawn.push(record.genome.accessoryId ?? null);
    }
    expect(drawn.length, "catch-up produced no visitors at all").toBeGreaterThan(0);
    expect(
      drawn.filter((id) => id !== null).length,
      "every catch-up visitor came out bare",
    ).toBeGreaterThan(0);
  });
});

describe("maxConcurrentVisitors is ENFORCED, not merely tuned", () => {
  const max = tuning.attractions.maxConcurrentVisitors;

  it("declares a cap worth enforcing (guards against a vacuous suite)", () => {
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(REAL_ATTRACTIONS.length);
  });

  it("six stocked, overdue attractions produce at most the cap — not six", () => {
    const next = visitorsAfterTick(keepWithAttractions(REAL_ATTRACTIONS.length, 5));
    const present = Object.values(next.visitors ?? {}).filter((r) => visitorIsPresent(r, T0));
    expect(present.length).toBeLessThanOrEqual(max);
    // Anti-vacuous: the cap must be binding here, i.e. the scenario really
    // did have more due work than slots. Without this the test passes on a
    // build where attractions produce nothing at all.
    expect(present.length).toBe(max);
  });

  it("a capped attraction is DEFERRED, never charged: its stock and schedule are untouched", () => {
    const before = keepWithAttractions(REAL_ATTRACTIONS.length, 5);
    const after = visitorsAfterTick(before);
    const served = new Set(
      Object.entries(after.visitors ?? {})
        .filter(([, r]) => visitorIsPresent(r, T0))
        .map(([id]) => id),
    );
    const deferred = Object.keys(before.attractionStock ?? {}).filter((id) => !served.has(id));
    expect(deferred.length).toBeGreaterThan(0);
    for (const id of deferred) {
      expect(after.attractionStock?.[id], `${id} was charged for a visit nobody saw`).toBe(
        before.attractionStock?.[id],
      );
      expect(after.attractionSchedule?.[id], `${id}'s schedule advanced past a skipped visit`).toBe(
        before.attractionSchedule?.[id],
      );
    }
  });

  it("the deferred visit ARRIVES once a slot frees — the cap paces, it does not delete", () => {
    const first = visitorsAfterTick(keepWithAttractions(REAL_ATTRACTIONS.length, 5));
    const servedFirst = new Set(
      Object.entries(first.visitors ?? {})
        .filter(([, r]) => visitorIsPresent(r, T0))
        .map(([id]) => id),
    );
    // Long enough after that everyone from the first wave has gone home.
    const later = T0 + tuning.attractions.lingerMs + 1;
    const second = visitorsAfterTick({ ...first, lastTickAt: T0 }, later);
    const servedSecond = new Set(
      Object.entries(second.visitors ?? {})
        .filter(([, r]) => visitorIsPresent(r, later))
        .map(([id]) => id),
    );
    const fresh = [...servedSecond].filter((id) => !servedFirst.has(id));
    expect(fresh.length, "no attraction that was capped out ever got its turn").toBeGreaterThan(0);
  });
});

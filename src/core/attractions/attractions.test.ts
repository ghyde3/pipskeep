/**
 * Attraction mechanics (docs/liveliness-bible.md §1) — visit cadence,
 * charge burn, the roll/reuse split, the visit-card actions, and the
 * "nobody welcomes them" harmless-decline path. Album/pity interaction
 * and offline catch-up have their own dedicated suites
 * (`album.test.ts`, `pity.test.ts`, `absence.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import type { KeepState } from "../keep";
import type { PipState } from "../pips/types";
import {
  ATTRACTION_STREAM,
  attractionBiomeIdFor,
  clearAttractionState,
  feedVisitor,
  initialAttractionStockFor,
  processAttractionVisits,
  refundForRemainingStock,
  restockAttraction,
  visitorIsPresent,
  visitorPool,
  welcomeVisitor,
} from "./index";
import type {
  AttractionBiomeRegistryView,
  AttractionContent,
  AttractionItemRegistryView,
  AttractionStateSlice,
  AttractionsTuning,
  CaughtPredicate,
} from "./index";
import type { GenomeSpeciesRegistry } from "../pips/genome";
import { NAME_STREAM } from "../pips/genome";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const T0 = 10_000_000;
const SEED = 42;

// ---------------------------------------------------------------------------
// Test content — one attraction ("attraction-a", biome "testbiome") with a
// three-species pool, two of which are caught by default.
// ---------------------------------------------------------------------------

const ITEMS: AttractionItemRegistryView = {
  "attraction-a": { effects: [{ kind: "attraction", biomeId: "testbiome" }] },
  "attraction-b": { effects: [{ kind: "attraction", biomeId: "otherbiome" }] },
  "plain-decoration": { effects: [{ kind: "comfort" }] },
};

const BIOMES: AttractionBiomeRegistryView = {
  testbiome: {
    eggSpecies: ["alpha", "beta", "gamma"],
    lootTable: [{ itemId: "snack-a" }, { itemId: "snack-b" }],
  },
  otherbiome: { eggSpecies: [], lootTable: [] },
};

const SPECIES: GenomeSpeciesRegistry = {
  alpha: { id: "alpha", rarity: "common", sprite: { palettes: ["p1"], patterns: ["s1"] } },
  beta: { id: "beta", rarity: "common", sprite: { palettes: ["p2"], patterns: ["s2"] } },
  gamma: { id: "gamma", rarity: "rare", sprite: { palettes: ["p3"], patterns: ["s3"] } },
};

const TUNING: AttractionsTuning = {
  attractions: {
    unlockKeepLevel: 6,
    visitIntervalMs: 6 * HOUR,
    lingerMs: 45 * MIN,
    maxConcurrentVisitors: 2,
    holdLastVisitOpen: true,
    stockMax: 4,
    welcomeTrust: 3,
    trustPerSnack: 1,
    maxSnacksPerVisit: 1,
    welcomeCost: { testbiome: { wood: 12 } },
    restockCost: { "attraction-a": { wood: 2, fiber: 4 } },
    visitorFedKeepXp: 6,
    welcomeKeepXp: 60,
    restockKeepXp: 2,
  },
};

const CONTENT: AttractionContent = {
  items: ITEMS,
  biomes: BIOMES,
  species: SPECIES,
  tuning: TUNING,
};

const caughtAlphaAndBeta: CaughtPredicate = (id) => id === "alpha" || id === "beta";
const caughtNothing: CaughtPredicate = () => false;

function keepWithAttraction(itemId = "attraction-a"): KeepState {
  return { level: 6, placements: { "place-1": { itemId, x: 0, y: 0 } } };
}

interface FullState extends AttractionStateSlice {
  readonly resources: Readonly<Record<string, number>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly pips: Readonly<Record<string, PipState>>;
  readonly rosterOrder: readonly string[];
}

function baseState(overrides: Partial<FullState> = {}): FullState {
  return {
    keep: keepWithAttraction(),
    seed: SEED,
    rngState: {},
    attractionStock: { "place-1": 4 },
    attractionSchedule: {},
    visitors: {},
    resources: { wood: 100, fiber: 100 },
    inventory: { "snack-a": 5, "snack-b": 5, berry: 5 },
    pips: {},
    rosterOrder: [],
    ...overrides,
  };
}

describe("attractionBiomeIdFor", () => {
  it("reads the biomeId off an item's attraction effect", () => {
    expect(attractionBiomeIdFor("attraction-a", ITEMS)).toBe("testbiome");
    expect(attractionBiomeIdFor("attraction-b", ITEMS)).toBe("otherbiome");
  });

  it("is undefined for every other item (jobs, comfort stations, unknown ids)", () => {
    expect(attractionBiomeIdFor("plain-decoration", ITEMS)).toBeUndefined();
    expect(attractionBiomeIdFor("nonexistent", ITEMS)).toBeUndefined();
  });
});

describe("visit cadence (bible §1.5) — deterministic, seeded, one charge per visit", () => {
  it("produces nothing before a full visitIntervalMs has elapsed", () => {
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const next = processAttractionVisits(state, T0 + 3 * HOUR, caughtAlphaAndBeta, new Set(), CONTENT);
    expect(next).toBe(state); // untouched by reference — nothing due
  });

  it("produces exactly one visit once due, consuming exactly one charge", () => {
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const at = T0 + 6 * HOUR;
    const next = processAttractionVisits(state, at, caughtAlphaAndBeta, new Set(), CONTENT);
    expect(next.attractionStock["place-1"]).toBe(3); // 4 - 1
    expect(next.attractionSchedule["place-1"]).toBe(at);
    const visitor = next.visitors["place-1"];
    expect(visitor).toBeDefined();
    expect(visitor?.arrivedAt).toBe(at);
    expect(visitor?.leavesAt).toBe(at + TUNING.attractions.lingerMs);
    expect(visitor?.visits).toBe(1);
    expect(visitor?.trust).toBe(0);
    expect(["alpha", "beta"]).toContain(visitor?.speciesId); // never gamma (uncaught)
  });

  it("is fully deterministic: the same seed/timeline/content produces the identical visitor twice", () => {
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const at = T0 + 6 * HOUR;
    const a = processAttractionVisits(state, at, caughtAlphaAndBeta, new Set(), CONTENT);
    const b = processAttractionVisits(state, at, caughtAlphaAndBeta, new Set(), CONTENT);
    expect(a.visitors["place-1"]).toEqual(b.visitors["place-1"]);
    expect(a.rngState).toEqual(b.rngState);
  });

  it("consumes exactly 6 rolls on ATTRACTION_STREAM and 1 on NAME_STREAM for a fresh visitor", () => {
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const at = T0 + 6 * HOUR;
    const next = processAttractionVisits(state, at, caughtAlphaAndBeta, new Set(), CONTENT);
    // Replay the same two streams independently from the seed and check
    // the cursor lands exactly where 6 + 1 draws would leave it.
    const rng = createRng(SEED);
    const attractionStream = rng.stream(ATTRACTION_STREAM);
    for (let i = 0; i < 6; i++) attractionStream.next();
    const nameStream = rng.stream(NAME_STREAM);
    nameStream.next();
    expect(next.rngState[ATTRACTION_STREAM]).toBe(attractionStream.getState());
    expect(next.rngState[NAME_STREAM]).toBe(nameStream.getState());
  });

  it("collapses multiple due ticks into ONE materialised visit, consuming one charge per tick", () => {
    // 18h elapsed against a 6h interval = 3 due ticks.
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const at = T0 + 18 * HOUR;
    const next = processAttractionVisits(state, at, caughtAlphaAndBeta, new Set(), CONTENT);
    expect(next.attractionStock["place-1"]).toBe(1); // 4 - 3
    expect(next.attractionSchedule["place-1"]).toBe(at);
    expect(next.visitors["place-1"]?.visits).toBe(1); // one roll, not three
  });

  it("an attraction at zero stock produces no visits, however overdue", () => {
    const state = baseState({
      attractionStock: { "place-1": 0 },
      attractionSchedule: { "place-1": T0 },
    });
    const next = processAttractionVisits(state, T0 + 100 * HOUR, caughtAlphaAndBeta, new Set(), CONTENT);
    expect(next).toBe(state);
  });

  it("the SAME visitor keeps coming back — no new roll on a second visit at the same placement", () => {
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const first = processAttractionVisits(state, T0 + 6 * HOUR, caughtAlphaAndBeta, new Set(), CONTENT);
    const firstVisitor = first.visitors["place-1"];
    const rngBefore = first.rngState;
    const second = processAttractionVisits(first, T0 + 12 * HOUR, caughtAlphaAndBeta, new Set(), CONTENT);
    expect(second.rngState).toEqual(rngBefore); // zero further rolls
    expect(second.visitors["place-1"]).toMatchObject({
      speciesId: firstVisitor?.speciesId,
      name: firstVisitor?.name,
      genome: firstVisitor?.genome,
      visits: 2,
      fedThisVisit: false,
    });
  });
});

describe("I1 — an empty pool is inert: zero rolls, zero stock consumed, zero schedule advance", () => {
  it("no species caught from this biome yet ⇒ nothing happens at all", () => {
    const state = baseState({ attractionSchedule: { "place-1": T0 } });
    const next = processAttractionVisits(state, T0 + 100 * HOUR, caughtNothing, new Set(), CONTENT);
    expect(next).toBe(state);
    expect(next.rngState).toEqual({});
  });
});

describe("welcomeVisitor (bible §1.7) — a complete individual, never a lesser one", () => {
  function withPresentVisitor(state: FullState, trust = TUNING.attractions.welcomeTrust): FullState {
    return {
      ...state,
      visitors: {
        "place-1": {
          placementId: "place-1",
          speciesId: "alpha",
          name: "Pipsqueak",
          genome: {
            speciesId: "alpha",
            palette: "p1",
            pattern: "s1",
            personalityId: "curious",
            shiny: false,
            // ⚠️ FIX STAGE — was `null`, which let the welcome assertion
            // below round-trip its own fixture: it proved the accessory
            // SLOT existed and never that anything was carried through it.
            // A real, distinguishable id makes the assertion mean "the
            // visitor arrives wearing what it wore".
            accessoryId: "scarf",
          },
          arrivedAt: T0,
          leavesAt: T0 + TUNING.attractions.lingerMs,
          trust,
          fedThisVisit: false,
          visits: 3,
        },
      },
    };
  }

  it("creates a full individual: rolled name, genome, WORN accessory, level 1, generation 0, Adult", () => {
    const state = withPresentVisitor(baseState());
    const { state: next, outcome } = welcomeVisitor(state, "place-1", "pip-99", T0 + 10, 5, CONTENT);
    expect(outcome).toMatchObject({ action: "welcomeVisitor", ok: true, pipId: "pip-99" });
    const pip = next.pips["pip-99"];
    expect(pip).toBeDefined();
    expect(pip?.name).toBe("Pipsqueak");
    expect(pip?.speciesId).toBe("alpha");
    expect(pip?.generation).toBe(0);
    expect(pip?.lifeStage).toBe("adult");
    expect(pip?.level ?? 1).toBe(1);
    // The whole genome crosses the welcome intact — the accessory it was
    // seen wearing in the Keep is the accessory it owns as a resident.
    // A welcomed Pip is never a stripped-down copy of the visitor.
    expect(pip?.genome.accessoryId).toBe("scarf");
    expect(next.rosterOrder).toContain("pip-99");
    // The record is cleared — "the next visit rolls a fresh one".
    expect(next.visitors["place-1"]).toBeUndefined();
    // The biome's welcomeCost was actually spent.
    expect(next.resources.wood ?? 0).toBe((state.resources.wood ?? 0) - 12);
  });

  it("consumes ZERO rng rolls — the genome/name were already rolled when the visitor was materialised", () => {
    const state = withPresentVisitor(baseState());
    const { state: next } = welcomeVisitor(state, "place-1", "pip-99", T0 + 10, 5, CONTENT);
    expect(next.rngState).toEqual(state.rngState);
  });

  it("below welcomeTrust refuses, state fully unchanged", () => {
    const state = withPresentVisitor(baseState(), 2);
    const { state: next, outcome } = welcomeVisitor(state, "place-1", "pip-99", T0 + 10, 5, CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "trustTooLow" });
    expect(next).toBe(state);
  });

  it("ROSTER-FULL is WARM and NON-DESTRUCTIVE: the visitor waits, trust is untouched, nothing is spent", () => {
    const state = withPresentVisitor(baseState({ rosterOrder: ["pip-1", "pip-2"] }));
    const { state: next, outcome } = welcomeVisitor(state, "place-1", "pip-99", T0 + 10, 2, CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "rosterFull" });
    expect(next).toBe(state); // byte-identical — nothing consumed, nobody cleared
    expect(next.visitors["place-1"]?.trust).toBe(TUNING.attractions.welcomeTrust);
  });

  it("refuses (state unchanged) when short on the biome's welcomeCost", () => {
    const state = withPresentVisitor(baseState({ resources: { wood: 1 } }));
    const { state: next, outcome } = welcomeVisitor(state, "place-1", "pip-99", T0 + 10, 5, CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "insufficientResources" });
    expect(next).toBe(state);
  });

  it("a visitor nobody welcomes simply LEAVES — no penalty, no state change, still reusable next visit", () => {
    const state = withPresentVisitor(baseState());
    // Time passes well beyond leavesAt; nobody ever welcomed them.
    const after = T0 + TUNING.attractions.lingerMs + HOUR;
    expect(visitorIsPresent(state.visitors["place-1"], after)).toBe(false);
    const { state: refused, outcome } = welcomeVisitor(state, "place-1", "pip-99", after, 5, CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "noVisitor" });
    expect(refused).toBe(state); // nothing lost — the record is simply stale, not punished
    // And the NEXT scheduled visit reuses it, unpenalised (trust intact).
    const nextVisitAt = after + 10;
    const revisited = processAttractionVisits(
      { ...state, attractionSchedule: { "place-1": after - TUNING.attractions.visitIntervalMs } },
      nextVisitAt,
      caughtAlphaAndBeta,
      new Set(),
      CONTENT,
    );
    expect(revisited.visitors["place-1"]?.trust).toBe(TUNING.attractions.welcomeTrust);
  });
});

describe("feedVisitor (bible §1.5) — always a gift, trust only once per visit for the right biome", () => {
  function withPresentVisitor(state: FullState): FullState {
    return {
      ...state,
      visitors: {
        "place-1": {
          placementId: "place-1",
          speciesId: "alpha",
          name: "Pipsqueak",
          genome: {
            speciesId: "alpha",
            palette: "p1",
            pattern: "s1",
            personalityId: "curious",
            shiny: false,
          },
          arrivedAt: T0,
          leavesAt: T0 + TUNING.attractions.lingerMs,
          trust: 0,
          fedThisVisit: false,
          visits: 1,
        },
      },
    };
  }

  it("a biome-correct snack consumes the item and grants trust", () => {
    const state = withPresentVisitor(baseState());
    const { state: next, outcome } = feedVisitor(state, "place-1", "snack-a", T0 + 5, CONTENT);
    expect(outcome).toMatchObject({ ok: true, trustGained: true });
    expect(next.visitors["place-1"]?.trust).toBe(1);
    expect(next.visitors["place-1"]?.fedThisVisit).toBe(true);
    expect(next.inventory["snack-a"] ?? 0).toBe((state.inventory["snack-a"] ?? 0) - 1);
  });

  it("a snack from elsewhere is still ACCEPTED (consumed) but earns nothing — never refused for being wrong", () => {
    const state = withPresentVisitor(baseState());
    const { state: next, outcome } = feedVisitor(state, "place-1", "berry", T0 + 5, CONTENT);
    expect(outcome).toMatchObject({ ok: true, trustGained: false });
    expect(next.visitors["place-1"]?.trust).toBe(0);
    expect(next.inventory.berry ?? 0).toBe((state.inventory.berry ?? 0) - 1);
  });

  it("a second biome-correct snack in the SAME visit is consumed but grants no further trust (once per visit)", () => {
    const fed = feedVisitor(withPresentVisitor(baseState()), "place-1", "snack-a", T0 + 5, CONTENT).state;
    const { state: next, outcome } = feedVisitor(fed, "place-1", "snack-b", T0 + 6, CONTENT);
    expect(outcome).toMatchObject({ ok: true, trustGained: false });
    expect(next.visitors["place-1"]?.trust).toBe(1); // unchanged
  });

  it("refuses (unchanged) when nobody is present, or the item isn't owned", () => {
    const noVisitor = baseState();
    const r1 = feedVisitor(noVisitor, "place-1", "snack-a", T0, CONTENT);
    expect(r1.outcome).toMatchObject({ ok: false, reason: "noVisitor" });
    expect(r1.state).toBe(noVisitor);

    const broke = withPresentVisitor(baseState({ inventory: {} }));
    const r2 = feedVisitor(broke, "place-1", "snack-a", T0 + 5, CONTENT);
    expect(r2.outcome).toMatchObject({ ok: false, reason: "insufficientItem" });
    expect(r2.state).toBe(broke);
  });
});

describe("restockAttraction (bible §1.4) — flat, never-inflating", () => {
  it("refills to stockMax for the flat restockCost", () => {
    const state = baseState({ attractionStock: { "place-1": 1 } });
    const { state: next, outcome } = restockAttraction(state, "place-1", T0, CONTENT);
    expect(outcome).toMatchObject({ ok: true });
    expect(next.attractionStock["place-1"]).toBe(4);
    expect(next.resources.wood ?? 0).toBe((state.resources.wood ?? 0) - 2);
    expect(next.resources.fiber ?? 0).toBe((state.resources.fiber ?? 0) - 4);
  });

  it("refuses when already full (never wastes a restock)", () => {
    const state = baseState({ attractionStock: { "place-1": 4 } });
    const { state: next, outcome } = restockAttraction(state, "place-1", T0, CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "alreadyFull" });
    expect(next).toBe(state);
  });

  it("refuses (unchanged) when short on cost", () => {
    const state = baseState({ attractionStock: { "place-1": 0 }, resources: {} });
    const { state: next, outcome } = restockAttraction(state, "place-1", T0, CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "insufficientResources" });
    expect(next).toBe(state);
  });
});

describe("PLACE_ITEM / REMOVE_ITEM seams", () => {
  it("initialAttractionStockFor stamps FULL stock and seeds the schedule at placement time", () => {
    const init = initialAttractionStockFor("attraction-a", T0, CONTENT);
    expect(init).toEqual({ biomeId: "testbiome", stock: 4, scheduleAt: T0 });
    expect(initialAttractionStockFor("plain-decoration", T0, CONTENT)).toBeUndefined();
  });

  it("refundForRemainingStock prices remaining charges at restockCost/stockMax, floored", () => {
    // restockCost is wood 2 / fiber 4 over stockMax 4 ⇒ 0.5 wood, 1 fiber per charge.
    expect(refundForRemainingStock("attraction-a", 1, CONTENT)).toEqual({ fiber: 1 }); // wood floors to 0
    expect(refundForRemainingStock("attraction-a", 2, CONTENT)).toEqual({ wood: 1, fiber: 2 });
    expect(refundForRemainingStock("attraction-a", 4, CONTENT)).toEqual({ wood: 2, fiber: 4 });
    expect(refundForRemainingStock("attraction-a", 0, CONTENT)).toEqual({});
    expect(refundForRemainingStock("plain-decoration", 4, CONTENT)).toEqual({});
  });

  it("clearAttractionState drops every trace for a removed placement, byte-reference no-op otherwise", () => {
    const state = baseState({
      attractionSchedule: { "place-1": T0 },
      visitors: {
        "place-1": {
          placementId: "place-1",
          speciesId: "alpha",
          name: "X",
          genome: { speciesId: "alpha", palette: "p1", pattern: "s1", personalityId: "curious", shiny: false },
          arrivedAt: T0,
          leavesAt: T0 + 10,
          trust: 1,
          fedThisVisit: false,
          visits: 1,
        },
      },
    });
    const cleared = clearAttractionState(state, "place-1");
    expect(cleared.attractionStock["place-1"]).toBeUndefined();
    expect(cleared.attractionSchedule["place-1"]).toBeUndefined();
    expect(cleared.visitors["place-1"]).toBeUndefined();

    const untouched = clearAttractionState(cleared, "place-1");
    expect(untouched).toBe(cleared); // nothing to clear — reference-stable
  });
});

describe("visitorPool (I1)", () => {
  it("intersects the biome's eggSpecies with the caught set", () => {
    expect(visitorPool("testbiome", caughtAlphaAndBeta, BIOMES)).toEqual(["alpha", "beta"]);
    expect(visitorPool("testbiome", caughtNothing, BIOMES)).toEqual([]);
    expect(visitorPool("testbiome", () => true, BIOMES)).toEqual(["alpha", "beta", "gamma"]);
  });
});

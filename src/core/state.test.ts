/**
 * GameState + root reducer tests (spec §2, §5, §4.5, §10.1, Phase 2):
 * createNewGame's deterministic genesis (starter mosspip, random
 * personality, Hunger ~60, 3 Berries), TICK exactness against
 * applyNeedsDelta plus the automatic evaluators, care delegation with
 * lastCareOutcome, CATCHUP delegation to runCatchup, and reducer purity
 * (deep-frozen inputs, structural sharing allowed).
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "./clock";
import { HOUR_MS, SECOND_MS, tuning } from "../content/tuning";
import { PERSONALITY_IDS } from "../content/personalities";
import { createStore } from "./store";
import { LifeStage, PipActivity } from "./pips/types";
import type { PipNeeds, PipState } from "./pips/types";
import { applyNeedsDelta } from "./pips/needs";
import { runCatchup } from "./pips/catchup";
import { GENESIS_STREAM, STARTER_HUNGER, createNewGame, rootReducer } from "./state";
import type { GameAction, GameState } from "./state";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
  ...overrides,
});

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
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function makeState(
  overrides: Partial<GameState> & { pip?: PipState } = {},
): GameState {
  const pip = overrides.pip ?? makePip();
  return {
    pips: { [pip.id]: pip },
    rosterOrder: [pip.id],
    activePipId: pip.id,
    inventory: { berry: 3, stew: 1 },
    resources: {},
    rngState: {},
    seed: 42,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: 0,
    lastTickAt: 0,
    lastCareOutcome: null,
    lastCatchup: null,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const pip = (state: GameState, id = "pip-1"): PipState => {
  const p = state.pips[id];
  if (p === undefined) throw new Error(`${id} missing`);
  return p;
};

describe("createNewGame — spec §10.1 / §6.3", () => {
  it("creates exactly one starter mosspip with Hunger at 60 and 3 Berries", () => {
    const state = createNewGame(7, 1_000);
    expect(state.rosterOrder).toHaveLength(1);
    const starter = pip(state, state.rosterOrder[0] as string);
    expect(starter.speciesId).toBe("mosspip");
    expect(starter.needs.hunger).toBe(STARTER_HUNGER);
    expect(STARTER_HUNGER).toBe(60); // spec §10.1: bar visibly at ~60
    expect(starter.needs.cleanliness).toBe(100);
    expect(starter.needs.happiness).toBe(100);
    expect(starter.needs.energy).toBe(100);
    expect(state.inventory).toEqual(tuning.startingInventory); // 3 Berries
    expect(state.activePipId).toBe(starter.id);
    expect(state.createdAt).toBe(1_000);
    expect(state.lastTickAt).toBe(1_000);
  });

  it("the starter is an Idle ADULT (Piplings refuse the guided first expedition, §4.6/§10.1)", () => {
    const starter = pip(createNewGame(7, 0));
    expect(starter.lifeStage).toBe(LifeStage.Adult);
    expect(starter.activity).toBe(PipActivity.Idle);
    expect(starter.expedition).toBeNull();
  });

  it("personality comes from the genesis stream: valid, deterministic per seed, varied across seeds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const state = createNewGame(seed, 0);
      const starter = pip(state);
      expect(PERSONALITY_IDS).toContain(starter.personalityId);
      expect(starter.genome.personalityId).toBe(starter.personalityId);
      seen.add(starter.personalityId);
    }
    expect(seen.size).toBeGreaterThan(1); // actually random, not constant
  });

  it("is fully deterministic for the same seed and captures the genesis cursor", () => {
    const a = createNewGame(123, 5_000);
    const b = createNewGame(123, 5_000);
    expect(a).toEqual(b);
    expect(a.rngState[GENESIS_STREAM]).toBeTypeOf("number");
    expect(a.seed).toBe(123);
  });
});

describe("rootReducer TICK — spec §4.1 needs advance + automatic evaluators", () => {
  it("advances needs EXACTLY as applyNeedsDelta for the elapsed time", () => {
    const clock = new FakeClock(10_000);
    const p = makePip({ needsUpdatedAt: clock.now() });
    const state = makeState({ pip: p, lastTickAt: clock.now() });
    clock.advance(1.5 * HOUR_MS);
    const next = rootReducer(state, { type: "TICK", at: clock.now() });
    const expected = applyNeedsDelta(p, 1.5);
    expect(pip(next).needs).toEqual(expected.needs);
    expect(pip(next).ageMs).toBe(expected.ageMs);
    expect(pip(next).happinessIntegral).toBe(expected.happinessIntegral);
    expect(pip(next).needsUpdatedAt).toBe(expected.needsUpdatedAt);
    expect(next.lastTickAt).toBe(clock.now());
  });

  it("a Resting pip regenerates and auto-wakes when Energy reaches 100", () => {
    const p = makePip({
      activity: PipActivity.Resting,
      needs: needs({ energy: 70 }),
    });
    const state = makeState({ pip: p });
    const next = rootReducer(state, { type: "TICK", at: 2 * HOUR_MS });
    expect(pip(next).needs.energy).toBe(100); // 70 + 15/h × 2h, clamped exact
    expect(pip(next).activity).toBe(PipActivity.Idle); // auto-wake (spec §5)
  });

  it("a need hitting the floor enters Sulking (spec §4.4)", () => {
    const p = makePip({ needs: needs({ hunger: 5 }) });
    const state = makeState({ pip: p });
    const next = rootReducer(state, { type: "TICK", at: HOUR_MS });
    expect(pip(next).needs.hunger).toBe(0); // 5 − 6, clamped
    expect(pip(next).activity).toBe(PipActivity.Sulking);
  });

  it("a Pipling past 24h becomes an Adult during TICK (spec §4.6)", () => {
    const p = makePip({ lifeStage: LifeStage.Pipling, hatchedAt: 0 });
    const state = makeState({ pip: p });
    const next = rootReducer(state, { type: "TICK", at: 25 * HOUR_MS });
    expect(pip(next).lifeStage).toBe(LifeStage.Adult);
  });

  it("evolution readiness is evaluated during TICK (spec §4.6)", () => {
    const ageMs = 80 * HOUR_MS;
    const p = makePip({
      ageMs,
      happinessIntegral: 75 * ageMs, // lifetime average 75 ≥ 70
      needs: needs({ happiness: 100 }),
    });
    const state = makeState({ pip: p });
    const next = rootReducer(state, { type: "TICK", at: SECOND_MS });
    expect(pip(next).readyToEvolve).toBe(true);
  });

  it("clock rollback: TICK earlier than lastTickAt changes nothing and never rewinds", () => {
    const p = makePip({ needsUpdatedAt: 10_000 });
    const state = makeState({ pip: p, lastTickAt: 10_000 });
    const next = rootReducer(state, { type: "TICK", at: 4_000 });
    expect(pip(next).needs).toEqual(p.needs);
    expect(next.lastTickAt).toBe(10_000);
  });
});

describe("rootReducer care actions — delegation + lastCareOutcome", () => {
  it("FEED consumes inventory, applies the food, and parks the outcome for the UI", () => {
    const state = makeState();
    const next = rootReducer(state, {
      type: "FEED",
      pipId: "pip-1",
      foodId: "berry",
      at: 1_000,
    });
    expect(pip(next).needs.hunger).toBe(100); // 80 + 25, clamped from 105
    expect(next.inventory["berry"]).toBe(2);
    expect(next.lastCareOutcome?.applied).toBe(true);
    expect(next.lastCareOutcome?.action).toBe("feed");
    expect(next.lastCareOutcome?.lineId).toBeDefined();
  });

  it("CLEAN respects its 60s cooldown across dispatches (FakeClock boundaries)", () => {
    const clock = new FakeClock(0);
    let state = makeState({ pip: makePip({ needs: needs({ cleanliness: 10 }) }) });
    state = rootReducer(state, { type: "CLEAN", pipId: "pip-1", at: clock.now() });
    expect(pip(state).needs.cleanliness).toBe(100);
    expect(state.lastCareOutcome?.applied).toBe(true);

    clock.advance(60 * SECOND_MS - 1);
    state = rootReducer(state, { type: "CLEAN", pipId: "pip-1", at: clock.now() });
    expect(state.lastCareOutcome?.applied).toBe(false);
    expect(state.lastCareOutcome?.refusalReason).toBe("cooldown");

    clock.advance(1);
    state = rootReducer(state, { type: "CLEAN", pipId: "pip-1", at: clock.now() });
    expect(state.lastCareOutcome?.applied).toBe(true);
  });

  it("PLAY, PET, REST_TOGGLE and GIVE_ITEM route through performCare", () => {
    let state = makeState();
    state = rootReducer(state, { type: "PLAY", pipId: "pip-1", at: 0 });
    expect(pip(state).needs.happiness).toBe(100); // 80 + 20
    expect(pip(state).needs.energy).toBe(70);

    state = rootReducer(state, { type: "PET", pipId: "pip-1", at: 1 });
    expect(state.lastCareOutcome?.applied).toBe(true);

    state = rootReducer(state, { type: "REST_TOGGLE", pipId: "pip-1", at: 2 });
    expect(pip(state).activity).toBe(PipActivity.Resting);

    state = rootReducer(state, {
      type: "GIVE_ITEM",
      pipId: "pip-1",
      itemId: "berry",
      at: 3,
    });
    expect(pip(state).lastGiftItemId).toBe("berry");
    expect(state.inventory["berry"]).toBe(2);
  });
});

describe("rootReducer CATCHUP — delegates to runCatchup (spec §4.5)", () => {
  it("produces exactly runCatchup's pips, stores the summary, and advances lastTickAt", () => {
    const p = makePip({ needsUpdatedAt: 1_000 });
    const state = makeState({ pip: p, lastTickAt: 1_000 });
    const savedAt = 1_000;
    const now = savedAt + 3 * HOUR_MS;

    const expected = runCatchup({ pips: [p] }, savedAt, now);
    const next = rootReducer(state, { type: "CATCHUP", savedAt, now });

    expect(pip(next)).toEqual(expected.state.pips[0]);
    expect(next.lastCatchup).toEqual(expected.summary);
    expect(next.lastTickAt).toBe(now);
  });

  it("applies the 12h offline rate cap through the delegation", () => {
    const p = makePip({ needsUpdatedAt: 0 });
    const state = makeState({ pip: p, lastTickAt: 0 });
    const now = 48 * HOUR_MS;
    const next = rootReducer(state, { type: "CATCHUP", savedAt: 0, now });
    const expected = runCatchup({ pips: [p] }, 0, now);
    expect(pip(next).needs).toEqual(expected.state.pips[0]?.needs);
    expect(next.lastCatchup?.ratedMs).toBe(tuning.offlineRateCapMs);
    expect(next.lastCatchup?.cappedMs).toBe(now - tuning.offlineRateCapMs);
  });
});

describe("rootReducer DEBUG_GRANT — the debug menu's grant seam (spec §14)", () => {
  it("adds exact item and resource deltas, creating missing entries", () => {
    const state = makeState(); // inventory { berry: 3, stew: 1 }
    const next = rootReducer(state, {
      type: "DEBUG_GRANT",
      items: { berry: 5, stew: 1 },
      resources: { wood: 10, fiber: 10 },
    });
    expect(next.inventory).toStrictEqual({ berry: 8, stew: 2 });
    expect(next.resources).toStrictEqual({ wood: 10, fiber: 10 });
    // Nothing else moves — pips are the same object.
    expect(next.pips).toBe(state.pips);
    expect(next.lastTickAt).toBe(state.lastTickAt);
  });

  it("omitted fields leave their record untouched (same reference)", () => {
    const state = makeState();
    const next = rootReducer(state, { type: "DEBUG_GRANT", items: { berry: 1 } });
    expect(next.resources).toBe(state.resources);
    const again = rootReducer(state, {
      type: "DEBUG_GRANT",
      resources: { shell: 10 },
    });
    expect(again.inventory).toBe(state.inventory);
  });
});

describe("rootReducer LOAD_SAVE — validated-save replacement (debug import)", () => {
  it("replaces the world wholesale and nulls the transient UI echoes", () => {
    const running = makeState();
    const imported = makeState({
      pip: makePip({ id: "pip-9", name: "Importpip" }),
      seed: 777,
      inventory: { stew: 4 },
      lastCareOutcome: {} as GameState["lastCareOutcome"],
      lastCatchup: {} as GameState["lastCatchup"],
    });
    const next = rootReducer(running, { type: "LOAD_SAVE", state: imported });
    expect(next.seed).toBe(777);
    expect(next.pips["pip-9"]?.name).toBe("Importpip");
    expect(next.pips["pip-1"]).toBeUndefined();
    expect(next.inventory).toStrictEqual({ stew: 4 });
    // Stale echoes from the imported blob never replay animations.
    expect(next.lastCareOutcome).toBeNull();
    expect(next.lastCatchup).toBeNull();
  });
});

describe("rootReducer purity — input state is never mutated", () => {
  const actions: GameAction[] = [
    { type: "TICK", at: HOUR_MS },
    { type: "FEED", pipId: "pip-1", foodId: "berry", at: 1 },
    { type: "CLEAN", pipId: "pip-1", at: 1 },
    { type: "PLAY", pipId: "pip-1", at: 1 },
    { type: "PET", pipId: "pip-1", at: 1 },
    { type: "REST_TOGGLE", pipId: "pip-1", at: 1 },
    { type: "GIVE_ITEM", pipId: "pip-1", itemId: "stew", at: 1 },
    { type: "CATCHUP", savedAt: 0, now: HOUR_MS },
    { type: "DEBUG_GRANT", items: { berry: 5 }, resources: { wood: 10 } },
    { type: "LOAD_SAVE", state: makeState() },
  ];

  it("every action type runs cleanly on a deep-frozen state", () => {
    for (const action of actions) {
      const state = deepFreeze(makeState());
      // Frozen objects throw on any mutation in strict mode.
      expect(() => rootReducer(state, action)).not.toThrow();
    }
  });

  it("structural sharing is allowed but the input snapshot stays intact", () => {
    const state = makeState();
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
    for (const action of actions) {
      rootReducer(state, action);
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
  });
});

describe("store integration — one-way flow end to end", () => {
  it("createStore(rootReducer, createNewGame(...)) plays a first minute", () => {
    const clock = new FakeClock(0);
    const store = createStore(rootReducer, createNewGame(99, clock.now()));
    const starterId = store.getState().rosterOrder[0] as string;

    clock.advance(30 * SECOND_MS);
    store.dispatch({ type: "TICK", at: clock.now() });
    const afterTick = store.getState();
    expect(pip(afterTick, starterId).needs.hunger).toBeLessThan(60);

    store.dispatch({
      type: "FEED",
      pipId: starterId,
      foodId: "berry",
      at: clock.now(),
    });
    const afterFeed = store.getState();
    expect(afterFeed.inventory["berry"]).toBe(2);
    expect(pip(afterFeed, starterId).needs.hunger).toBeGreaterThan(
      pip(afterTick, starterId).needs.hunger,
    );
    expect(afterFeed.lastCareOutcome?.applied).toBe(true);
    expect(afterFeed.lastCareOutcome?.line).toBeTypeOf("string");
  });
});

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
import type { PipId, PipNeeds, PipState } from "./pips/types";
import { applyNeedsDelta } from "./pips/needs";
import { runCatchup } from "./pips/catchup";
import { ROSTER_FULL_MESSAGE, rosterFullMaxMessage } from "../content/eggs";
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
      shiny: false,
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
    evolved: null,
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
    keep: { level: 1, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: 2,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: 0,
    lastTickAt: 0,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
    lastJobOutcome: null,
    lastEvolveOutcome: null,
    onboarding: { completed: true, step: "done" },
    pipdex: {
      entries: {},
      discoveryOrder: [],
      formsSeen: 0,
      formsCaught: 0,
      variantsCaught: 0,
      shiniesCaught: 0,
      unreadEntryIds: [],
    },
    sanctuary: { pips: {}, order: [] },
    lastSanctuaryOutcome: null,
    // ROUND 2C — progression stack defaults (docs/retention-bible.md).
    streak: {
      current: 0,
      longest: 0,
      lastVisitDay: null,
      totalVisitDays: 0,
      graceBanked: 2,
      graceRefilledOnDay: null,
      rainDays: 0,
      rewardedForDay: null,
      pendingChoices: [],
    },
    dayOffsetMs: 0,
    counters: {},
    milestones: { earned: {}, pendingCelebrations: [] },
    bounties: { day: null, slots: [], rerollsUsed: 0, dayBonusGranted: false },
    eggPity: {},
    activeEvents: [],
    keepsakes: {},
    flair: {},
    keepXp: 0,
    lastLevelUp: null,
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
    expect(pip(next).needs.energy).toBe(100); // regen for 2h, clamped exact
    expect(pip(next).activity).toBe(PipActivity.Idle); // auto-wake (spec §5)
  });

  it("a need hitting the floor enters Sulking (spec §4.4)", () => {
    // Half an hour's worth of Hunger, then a full hour of decay: the
    // need crosses the floor and clamps. Derived from tuning so a
    // rebalance moves the seed rather than breaking the claim.
    const p = makePip({
      needs: needs({ hunger: -tuning.needDecayPerHour.hunger / 2 }),
    });
    const state = makeState({ pip: p });
    const next = rootReducer(state, { type: "TICK", at: HOUR_MS });
    expect(pip(next).needs.hunger).toBe(0); // clamped at the floor
    expect(pip(next).activity).toBe(PipActivity.Sulking);
  });

  it("a Pipling past pipling.durationMs becomes an Adult during TICK (spec §4.6)", () => {
    // 25h clears the boundary regardless of the current tuned duration
    // (round 2A: 8h, was 24h) — comfortably past either.
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

describe("rootReducer SET_ACTIVE_PIP — top-bar selector (spec §10)", () => {
  const twoPips = (): GameState => {
    const first = makePip();
    const second = makePip({ id: "pip-2", name: "Secondpip" });
    return makeState({
      pips: { [first.id]: first, [second.id]: second },
      rosterOrder: [first.id, second.id],
      activePipId: first.id,
    });
  };

  it("switches activePipId to another roster pip and touches nothing else", () => {
    const state = twoPips();
    const next = rootReducer(state, { type: "SET_ACTIVE_PIP", pipId: "pip-2" });
    expect(next.activePipId).toBe("pip-2");
    expect(next.pips).toBe(state.pips); // structural sharing — pips untouched
    expect(next.rngState).toBe(state.rngState); // zero rolls consumed
    expect(next.rosterOrder).toBe(state.rosterOrder);
  });

  it("an away (OnExpedition) pip can still be selected — bars stay visible", () => {
    const away = makePip({
      id: "pip-2",
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1000 },
    });
    const state = makeState({
      pips: { "pip-1": makePip(), [away.id]: away },
      rosterOrder: ["pip-1", away.id],
    });
    const next = rootReducer(state, { type: "SET_ACTIVE_PIP", pipId: "pip-2" });
    expect(next.activePipId).toBe("pip-2");
  });

  it("unknown pipId and already-active pipId are exact no-ops (same reference)", () => {
    const state = twoPips();
    expect(rootReducer(state, { type: "SET_ACTIVE_PIP", pipId: "pip-99" })).toBe(
      state,
    );
    expect(rootReducer(state, { type: "SET_ACTIVE_PIP", pipId: "pip-1" })).toBe(
      state,
    );
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
    { type: "SET_ACTIVE_PIP", pipId: "pip-1" },
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

  it("a Sulking Pip at 0 Energy naps its way out of the Sulk — store.dispatch to recovery", () => {
    // The round 2A soft-lock, pinned end to end at the outermost seam.
    // `beginRest` used to require Idle, so a Pip that Sulked at 0 Energy
    // could never Rest, and Rest is the ONLY source of Energy — §4.4's
    // "recovery is always one good care session away" was unreachable.
    // Every layer of that path is covered elsewhere (machine.test.ts under
    // fixture rates, care.test.ts through performCare, the TICK auto-wake
    // above); this one drives the WHOLE thing — store → reducer → care →
    // machine → tick — with the shipped tuning and a real clock.
    const clock = new FakeClock(1_000);
    const store = createStore(rootReducer, createNewGame(4, clock.now()));
    const starterId = store.getState().rosterOrder[0] as string;

    // Bottom out Energy: the pip sulks the moment a need hits the floor.
    store.dispatch({
      type: "LOAD_SAVE",
      state: {
        ...store.getState(),
        pips: {
          ...store.getState().pips,
          [starterId]: {
            ...(store.getState().pips[starterId] as PipState),
            activity: PipActivity.Sulking,
            sulking: true,
            needs: { hunger: 60, cleanliness: 60, happiness: 60, energy: 0 },
          },
        },
      },
    });
    expect(pip(store.getState(), starterId).activity).toBe(PipActivity.Sulking);

    // One tap: the Sulking Pip lies down instead of refusing.
    store.dispatch({ type: "REST_TOGGLE", pipId: starterId, at: clock.now() });
    expect(store.getState().lastCareOutcome?.applied).toBe(true);
    expect(pip(store.getState(), starterId).activity).toBe(PipActivity.Resting);
    // Still sulking WHILE it naps — the nap is progress, not absolution.
    expect(pip(store.getState(), starterId).sulking).toBe(true);

    // Energy crosses the §4.4 exit threshold partway through the nap.
    const toExitMs =
      (tuning.sulkExitThreshold / tuning.care.rest.energyPerHour) * HOUR_MS;
    clock.advance(toExitMs);
    store.dispatch({ type: "TICK", at: clock.now() });
    const midNap = pip(store.getState(), starterId);
    expect(midNap.needs.energy).toBeGreaterThanOrEqual(
      tuning.sulkExitThreshold,
    );
    expect(midNap.sulking).toBe(false);
    // A recovered Pip keeps napping — nothing interrupts a rest.
    expect(midNap.activity).toBe(PipActivity.Resting);

    // ...and wakes on its own at full Energy.
    clock.advance(
      (tuning.care.rest.autoWakeAtEnergy / tuning.care.rest.energyPerHour) *
        HOUR_MS,
    );
    store.dispatch({ type: "TICK", at: clock.now() });
    const awake = pip(store.getState(), starterId);
    expect(awake.needs.energy).toBe(tuning.care.rest.autoWakeAtEnergy);
    expect(awake.activity).toBe(PipActivity.Idle);
    expect(awake.sulking).toBe(false);
  });
});

/** Hatch a second Pip via the debug-egg seam (spec §14) so tests below can
 * retire the starter without hitting the "last active Pip" refusal.
 * Returns the state after hatching and the newborn's id. */
function hatchSecondPip(
  state: GameState,
  at: number,
): { state: GameState; pipId: PipId } {
  let next = rootReducer(state, { type: "DEBUG_SPAWN_EGG", at });
  const spawned = next.eggs[next.eggs.length - 1];
  if (spawned === undefined) throw new Error("expected a spawned egg");
  next = rootReducer(next, { type: "TICK", at: at + spawned.incubationMs + 1 });
  const before = new Set(next.rosterOrder);
  next = rootReducer(next, {
    type: "HATCH_EGG",
    eggId: spawned.id,
    at: at + spawned.incubationMs + 2,
  });
  if (next.lastHatchOutcome?.ok !== true) {
    throw new Error("expected HATCH_EGG to succeed");
  }
  const pipId = next.rosterOrder.find((id) => !before.has(id));
  if (pipId === undefined) throw new Error("expected a newborn roster entry");
  return { state: next, pipId };
}

describe("ROUND 2C — the Album (pipdex) wiring (docs/retention-bible.md §1)", () => {
  it("createNewGame catches the starter species immediately (bible §11.3 fresh-game case)", () => {
    const state = createNewGame(7, 1_000);
    const starter = pip(state);
    const entry = state.pipdex.entries[starter.speciesId];
    expect(entry?.caughtAt).toBe(1_000);
    expect(entry?.caughtCount).toBe(1);
    expect(entry?.firstPortrait?.pipId).toBe(starter.id);
    expect(entry?.firstPortrait?.genome).toEqual(starter.genome);
    expect(state.pipdex.formsCaught).toBe(1);
  });

  it("HATCH_EGG catches the hatchling's species (bible §1.1 Portrait tier)", () => {
    const state = createNewGame(7, 0);
    const starterSpeciesId = pip(state).speciesId;
    const beforeCaughtCount = state.pipdex.entries[starterSpeciesId]?.caughtCount ?? 0;
    const { state: hatched, pipId } = hatchSecondPip(state, 0);
    const hatchling = hatched.pips[pipId];
    if (hatchling === undefined) throw new Error("expected the hatchling");
    const entry = hatched.pipdex.entries[hatchling.speciesId];
    expect(entry?.caughtAt).not.toBeNull();
    expect(entry?.caughtCount).toBe(
      // The hatchling may happen to roll the SAME species as the starter
      // (caughtCount increments; the portrait stays frozen on the FIRST
      // catch) or a genuinely new one (caughtCount starts at 1) — either
      // way the hatch must have been recorded.
      hatchling.speciesId === starterSpeciesId ? beforeCaughtCount + 1 : 1,
    );
    // The portrait is frozen at first catch, never overwritten by a
    // later same-species hatch.
    if (hatchling.speciesId === starterSpeciesId) {
      expect(entry?.firstPortrait?.pipId).toBe("pip-1");
    } else {
      expect(entry?.firstPortrait?.pipId).toBe(pipId);
    }
  });

  it("EVOLVE_PIP catches the evolved species and records the gift-variant leaf on the BASE page", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const starter = pip(state, starterId);
    // Force readiness (age/happiness thresholds are lifecycle.test.ts's
    // job) and set the gift that selects mosspip's "sunorchard" variant.
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: {
          ...state.pips,
          [starterId]: {
            ...starter,
            readyToEvolve: true,
            lastGiftItemId: "honeydrop",
          },
        },
      },
    });
    state = rootReducer(state, { type: "EVOLVE_PIP", pipId: starterId, at: 10_000 });
    expect(state.lastEvolveOutcome?.ok).toBe(true);
    if (state.lastEvolveOutcome?.ok !== true) return;
    const { toSpeciesId, variantId, fromSpeciesId } = state.lastEvolveOutcome;

    const evolvedEntry = state.pipdex.entries[toSpeciesId];
    expect(evolvedEntry?.caughtAt).toBe(10_000);
    expect(evolvedEntry?.firstPortrait?.genome.speciesId).toBe(fromSpeciesId); // birth genome, unchanged

    // The ribbon lives on the BASE species' page, not the evolved one's.
    const baseEntry = state.pipdex.entries[fromSpeciesId];
    expect(baseEntry?.variantsCaught[variantId]).toBe(10_000);
    expect(evolvedEntry?.variantsCaught[variantId]).toBeUndefined();
  });

  it("ACKNOWLEDGE_REVEAL grants a Field note for every species in the completed trip's egg pool", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pendingReveals: [
          {
            pipId: starterId,
            expeditionId: "meadow",
            completedAt: 5_000,
            items: [],
            egg: null,
          },
        ],
      },
    });
    state = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: 6_000 });
    // meadow's eggSpecies pool (content/expeditions.ts) is ["mosspip", "cloudpip"].
    expect(state.pipdex.entries["cloudpip"]?.seenAt).toBe(6_000);
    expect(state.pipdex.entries["cloudpip"]?.caughtAt).toBeNull();
    // mosspip was already CAUGHT (the starter) but never separately SEEN
    // via a trip — this is the first time, and caughtAt is untouched.
    expect(state.pipdex.entries["mosspip"]?.seenAt).toBe(6_000);
    expect(state.pipdex.entries["mosspip"]?.caughtAt).toBe(0);
    expect(state.pipdex.entries["mosspip"]?.knownBiomes).toContain("meadow");
  });
});

describe("ROUND 2C — the Long Meadow: RETIRE_PIP / RETRIEVE_PIP (docs/retention-bible.md §2)", () => {
  it("refuses to retire the last active Pip", () => {
    const state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const next = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 1_000 });
    expect(next.lastSanctuaryOutcome).toEqual({
      action: "retire",
      ok: false,
      pipId: starterId,
      at: 1_000,
      reason: "lastPip",
    });
    expect(next.pips[starterId]).toBeDefined();
  });

  it("retiring an AssignedJob Pip auto-unassigns the job first (mirrors REMOVE_ITEM)", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;

    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        keep: {
          ...state.keep,
          placements: { "place-1": { itemId: "gathering-station", x: 0, y: 0 } },
        },
        pips: {
          ...state.pips,
          [starterId]: { ...pip(state, starterId), activity: PipActivity.AssignedJob },
        },
        jobs: {
          [starterId]: {
            jobId: "gathering",
            stationPlacementId: "place-1",
            assignedAt: 0,
            lastProducedAt: 0,
          },
        },
      },
    });
    expect(state.jobs[starterId]).toBeDefined();

    const retireAt = 50_000;
    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: retireAt });
    expect(state.lastSanctuaryOutcome?.ok).toBe(true);
    expect(state.jobs[starterId]).toBeUndefined();
    expect(state.sanctuary.pips[starterId]?.pip.activity).toBe(PipActivity.Idle);
  });

  it("a resident survives a 30-simulated-day absence untouched, then comes home byte-for-byte", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const before = pip(state, starterId);
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;

    const retireAt = 100_000;
    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: retireAt });
    expect(state.lastSanctuaryOutcome).toEqual({
      action: "retire",
      ok: true,
      pipId: starterId,
      at: retireAt,
    });
    expect(state.pips[starterId]).toBeUndefined();
    expect(state.rosterOrder).not.toContain(starterId);
    const residentAtRetire = state.sanctuary.pips[starterId];
    if (residentAtRetire === undefined) throw new Error("expected a resident record");
    expect(residentAtRetire.pip.needs).toEqual(tuning.retention.sanctuary.arrivalNeeds);

    // A real offline absence AND a live tick — neither touches the
    // resident, because it simply is not in `pips`/`rosterOrder` (the
    // freeze IS the exclusion, docs/retention-bible.md §2.4).
    const THIRTY_DAYS_MS = 30 * 24 * HOUR_MS;
    state = rootReducer(state, {
      type: "CATCHUP",
      savedAt: retireAt,
      now: retireAt + THIRTY_DAYS_MS,
    });
    state = rootReducer(state, {
      type: "TICK",
      at: retireAt + THIRTY_DAYS_MS + HOUR_MS,
    });

    const residentAfter = state.sanctuary.pips[starterId];
    expect(residentAfter?.pip.needs).toEqual(residentAtRetire.pip.needs);
    expect(residentAfter?.pip.ageMs).toBe(residentAtRetire.pip.ageMs);
    expect(residentAfter?.pip.happinessIntegral).toBe(
      residentAtRetire.pip.happinessIntegral,
    );

    const retrieveAt =
      retireAt + THIRTY_DAYS_MS + HOUR_MS + tuning.retention.sanctuary.minStayMs;
    state = rootReducer(state, {
      type: "RETRIEVE_PIP",
      pipId: starterId,
      at: retrieveAt,
    });
    expect(state.lastSanctuaryOutcome).toEqual({
      action: "retrieve",
      ok: true,
      pipId: starterId,
      at: retrieveAt,
    });
    const home = pip(state, starterId);
    expect(home.name).toBe(before.name);
    expect(home.genome).toEqual(before.genome);
    expect(home.needs).toEqual(tuning.retention.sanctuary.arrivalNeeds);
    expect(home.activity).toBe(PipActivity.Idle);
    expect(state.rosterOrder[state.rosterOrder.length - 1]).toBe(starterId);
    expect(state.sanctuary.pips[starterId]).toBeUndefined();
  });

  it("retrieve refuses before minStayMs and refuses warmly at the roster cap", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 0 });

    const tooSoon = rootReducer(state, {
      type: "RETRIEVE_PIP",
      pipId: starterId,
      at: tuning.retention.sanctuary.minStayMs - 1,
    });
    expect(tooSoon.lastSanctuaryOutcome).toEqual({
      action: "retrieve",
      ok: false,
      pipId: starterId,
      at: tuning.retention.sanctuary.minStayMs - 1,
      reason: "notSettled",
    });
  });

  it("the roster-full message points at the Long Meadow, not just the upgrade", () => {
    expect(ROSTER_FULL_MESSAGE).toContain("Long Meadow");
    expect(rosterFullMaxMessage(5)).toContain("Long Meadow");
    // ROUND 2F: it NAMES the cap, so a tier-11 sixth bed cannot make it lie.
    expect(rosterFullMaxMessage(6)).toContain("6 happy Pips");
  });

  it("retire/retrieve never touch the Album — the record is already permanent (bible §1.1)", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    const pipdexBeforeRetire = state.pipdex;

    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 1_000 });
    expect(state.pipdex).toBe(pipdexBeforeRetire); // same reference — untouched

    state = rootReducer(state, {
      type: "RETRIEVE_PIP",
      pipId: starterId,
      at: 1_000 + tuning.retention.sanctuary.minStayMs,
    });
    expect(state.pipdex).toBe(pipdexBeforeRetire); // still untouched
  });
});

describe("ROUND 2H — LIFECYCLE: per-Pip levels, ageing and the five promises (spec §16 v1.5)", () => {
  it("a care action grants this Pip's own Pip XP — a SEPARATE number from Keep XP", () => {
    const state0 = createNewGame(7, 0);
    const starterId = state0.rosterOrder[0] as string;
    const state1 = rootReducer(state0, {
      type: "FEED",
      pipId: starterId,
      foodId: "berry",
      at: 1_000,
    });
    expect(pip(state1, starterId).pipXp).toBe(tuning.lifecycle.level.xp.care);
    expect(state1.keepXp).toBeGreaterThan(0);
  });

  it("a completed expedition credits Pip XP to the Pip that went, at ACKNOWLEDGE_REVEAL", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    state = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: starterId,
      expeditionId: "meadow",
      at: 0,
    });
    const durationMs = tuning.expeditions.meadow.durationMs;
    state = rootReducer(state, { type: "TICK", at: durationMs + 1 });
    state = rootReducer(state, { type: "ACKNOWLEDGE_REVEAL", at: durationMs + 2 });
    const cfg = tuning.lifecycle.level.xp;
    const expected = cfg.tripBase + cfg.tripPer5Min * Math.floor(durationMs / (5 * 60 * 1000));
    expect(pip(state, starterId).pipXp).toBe(expected);
  });

  it("levelling up a Pip pays the matching Keep XP exactly once (bible §1.0/§9.3)", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const threshold2 = tuning.lifecycle.level.levelXp[1] as number;
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: { ...state.pips, [starterId]: { ...pip(state, starterId), pipXp: threshold2 - 1 } },
      },
    });
    const keepXpBefore = state.keepXp;
    state = rootReducer(state, { type: "FEED", pipId: starterId, foodId: "berry", at: 1_000 });
    expect(pip(state, starterId).level).toBe(2);
    expect(state.keepXp - keepXpBefore).toBeGreaterThanOrEqual(tuning.lifecycle.keepXp.pipLevel);
  });

  it("PROMISE 5: RETIRE_PIP refuses the last active Pip whether player-chosen OR age-ready", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: { ...state.pips, [starterId]: { ...pip(state, starterId), readyToRetire: true } },
      },
    });
    const next = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 1_000 });
    expect(next.lastSanctuaryOutcome).toEqual({
      action: "retire",
      ok: false,
      pipId: starterId,
      at: 1_000,
      reason: "lastPip",
    });
    expect(next.pips[starterId]?.readyToRetire).toBe(true); // still there, still ready
  });

  it("retiring an age-ready Pip (with a second Pip to spare) pays retirementWitnessed Keep XP", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: { ...state.pips, [starterId]: { ...pip(state, starterId), readyToRetire: true } },
      },
    });
    const keepXpBefore = state.keepXp;
    const nameBefore = pip(state, starterId).name;
    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 5_000 });
    expect(state.lastSanctuaryOutcome?.ok).toBe(true);
    expect(state.keepXp).toBeGreaterThanOrEqual(
      keepXpBefore + tuning.lifecycle.keepXp.retirementWitnessed,
    );

    // ⚠️ PROMISE 3 — "old age is peaceful". Everything above this line is
    // about XP, and a mutation that deleted the sanctuary record right
    // after `retireToSanctuary` wrote it left the whole suite green: the
    // retiree vanished from `pips`, `rosterOrder` AND `sanctuary` — the
    // one-place invariant violated in the direction nothing was watching,
    // taking the Pip's genome, name, evolution record and mastery with it.
    // A retirement that ENDS somewhere is the entire promise.
    expect(state.pips[starterId]).toBeUndefined();
    expect(state.rosterOrder).not.toContain(starterId);
    expect(state.sanctuary.pips[starterId]).toBeDefined();
    expect(state.sanctuary.order).toContain(starterId);
    expect(state.sanctuary.pips[starterId]?.pip.name).toBe(nameBefore);
    // ...and the record says WHY, so an age retirement is distinguishable
    // from a change of scene forever after (the Long Meadow's copy reads
    // this, and `"age"` was an unreachable value until it was wired).
    expect(state.sanctuary.pips[starterId]?.reason).toBe("age");
  });

  // The general form of the assertion above, as a standing guard: after
  // ANY retirement the Pip is in exactly one collection. This is the
  // reducer-level twin of `core/pips/ailment.test.ts`'s XOR check for the
  // LOSS path — that one existed, this one did not, which is precisely
  // why the promise-3 arm could be mutated without a single test noticing.
  it("PROMISE 3: RETIRE_PIP keeps the one-place invariant — every id is in pips XOR sanctuary", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    const everyId = [starterId, hatched.pipId];

    for (const [i, id] of everyId.entries()) {
      const before = { ...state.pips[id] } as PipState;
      state = rootReducer(state, { type: "RETIRE_PIP", pipId: id, at: 5_000 + i });
      const inRoster = state.pips[id] !== undefined;
      const inMeadow = state.sanctuary.pips[id] !== undefined;
      expect(inRoster !== inMeadow).toBe(true); // XOR — never both, never neither
      // Whichever side it landed on, the whole PipState survived.
      const survived = state.pips[id] ?? state.sanctuary.pips[id]?.pip;
      expect(survived?.genome).toEqual(before.genome);
      expect(survived?.name).toBe(before.name);
    }
    // The last Pip is refused (promise 5), so it is still in the roster —
    // and the XOR above held for it too, on the other side.
    expect(state.rosterOrder.length).toBeGreaterThanOrEqual(1);
  });

  it("a player-chosen retirement records reason 'player', not 'age'", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    state = hatchSecondPip(state, 0).state;
    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 5_000 });
    expect(state.sanctuary.pips[starterId]?.reason).toBe("player");
  });

  it("a manually-retired (NOT age-ready) Pip does not pay retirementWitnessed", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    const keepXpBefore = state.keepXp;
    state = rootReducer(state, { type: "RETIRE_PIP", pipId: starterId, at: 5_000 });
    expect(state.lastSanctuaryOutcome?.ok).toBe(true);
    // Only the (possible) first-ever-arrival bonus (20) — never
    // retirementWitnessed (40), which requires `readyToRetire`.
    expect(state.keepXp).toBeLessThan(
      keepXpBefore + tuning.lifecycle.keepXp.retirementWitnessed,
    );
  });

  it("PROMISE 2/5: a 3-week (21-day) absence never empties the Keep, and ages a Pip by at most the offline rate cap", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    const secondId = hatched.pipId;

    const nearEnd = (p: PipState): PipState => ({
      ...p,
      ageMs: 1000 * HOUR_MS,
      happinessIntegral: 50 * 1000 * HOUR_MS,
      lifeMs: 0.999 * tuning.lifecycle.lifespan.baseMs,
    });
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: {
          ...state.pips,
          [starterId]: nearEnd(pip(state, starterId)),
          [secondId]: nearEnd(pip(state, secondId)),
        },
      },
    });

    const savedAt = state.lastTickAt;
    state = rootReducer(state, {
      type: "CATCHUP",
      savedAt,
      now: savedAt + 21 * 24 * HOUR_MS,
    });

    // The Keep is never empty (promise 5) — nobody auto-retired, however
    // close to the end either Pip already was.
    expect(state.rosterOrder).toHaveLength(2);
    expect(Object.keys(state.sanctuary.pips)).toHaveLength(0);
    // lifeMs advanced by AT MOST the offline rate cap for each Pip —
    // never by the full 21 days (promise 2).
    for (const id of [starterId, secondId]) {
      expect(pip(state, id).lifeMs).toBeLessThanOrEqual(
        0.999 * tuning.lifecycle.lifespan.baseMs + tuning.offlineRateCapMs,
      );
    }
  });

  it("TICK/CATCHUP only ever SET readyToRetire — RETIRE_PIP is the sole action that ever moves a Pip to the sanctuary", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    const hatched = hatchSecondPip(state, 0);
    state = hatched.state;
    const secondId = hatched.pipId;

    // Push both WAY past any plausible lifespan.
    const overAge = (p: PipState): PipState => ({
      ...p,
      lifeMs: 100 * tuning.lifecycle.lifespan.baseMs,
    });
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: {
          ...state.pips,
          [starterId]: overAge(pip(state, starterId)),
          [secondId]: overAge(pip(state, secondId)),
        },
      },
    });

    // Repeated TICK and CATCHUP dispatches: the flag may (and should)
    // flip, but nobody may ever be MOVED.
    let t = state.lastTickAt;
    for (let i = 0; i < 10; i++) {
      t += HOUR_MS;
      state = rootReducer(state, { type: "TICK", at: t });
    }
    state = rootReducer(state, { type: "CATCHUP", savedAt: t, now: t + 5 * 24 * HOUR_MS });

    expect(state.rosterOrder).toHaveLength(2);
    expect(Object.keys(state.sanctuary.pips)).toHaveLength(0);
    expect(pip(state, starterId).readyToRetire).toBe(true);
    expect(pip(state, secondId).readyToRetire).toBe(true);
  });

  it("ASSIGN_EXPEDITION bakes this Pip's own expedition-speed level effect into departedAt/durationMs at send-off", () => {
    let state = createNewGame(7, 0);
    const starterId = state.rosterOrder[0] as string;
    state = rootReducer(state, {
      type: "LOAD_SAVE",
      state: {
        ...state,
        pips: {
          ...state.pips,
          [starterId]: { ...pip(state, starterId), level: tuning.lifecycle.level.maxLevel },
        },
      },
    });
    state = rootReducer(state, {
      type: "ASSIGN_EXPEDITION",
      pipId: starterId,
      expeditionId: "meadow",
      at: 0,
    });
    expect(state.lastAssignOutcome?.ok).toBe(true);
    if (state.lastAssignOutcome?.ok !== true) return;
    // A max-level Pip's own trail-legs effect makes the trip faster than
    // the base content duration, even on an unbuilt Keep.
    expect(state.lastAssignOutcome.durationMs).toBeLessThan(tuning.expeditions.meadow.durationMs);
  });
});

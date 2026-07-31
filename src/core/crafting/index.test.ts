/**
 * Crafting (core/crafting) — unit tests against INJECTED content, so this
 * file exercises the pure engine independent of the real recipe book
 * (`core/state.crafting.test.ts` covers the reducer-level, real-content
 * end-to-end path the task also requires).
 */

import { describe, expect, it } from "vitest";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipNeeds, PipState } from "../pips/types";
import type { JobsByPip } from "../keep/jobs";
import type { KeepState } from "../keep";
import {
  cancelCraft,
  collectCraftCatchupEvents,
  effectiveCraftDurationMs,
  enqueueCraft,
  refundCraftsAtStation,
  settleCraftCompletions,
  shiftCraftsPastFreeze,
} from "./index";
import type {
  CraftCatchupState,
  CraftingContent,
  CraftingJobRegistryView,
  CraftingTuning,
  CraftsByStation,
  CraftStateSlice,
  RecipeRegistryView,
} from "./index";

const T0 = 1_000_000;

const FIXTURE_TUNING: CraftingTuning = {
  queueMax: 2,
  speedMin: 0.9,
  speedFloorWithLevel: 0.82,
  pipLevelSpeed: [1, 0.95, 0.9],
};

const FIXTURE_RECIPES: RecipeRegistryView = {
  quick: {
    id: "quick",
    unlockKeepLevel: 1,
    resources: { wood: 2 },
    output: { kind: "item", itemId: "gizmo", count: 1 },
    durationMs: 10 * 60_000,
  },
  fancy: {
    id: "fancy",
    unlockKeepLevel: 1,
    resources: { wood: 1 },
    items: { berry: 3 },
    output: { kind: "item", itemId: "trinket", count: 2 },
    durationMs: 20 * 60_000,
  },
  shelfPiece: {
    id: "shelfPiece",
    unlockKeepLevel: 1,
    resources: { wood: 4 },
    output: { kind: "keepsake", itemId: "test-shelf-thing", count: 1 },
    durationMs: 15 * 60_000,
  },
  gated: {
    id: "gated",
    unlockKeepLevel: 5,
    resources: { wood: 1 },
    output: { kind: "item", itemId: "rare-thing", count: 1 },
    durationMs: 30 * 60_000,
  },
};

const FIXTURE_JOBS: CraftingJobRegistryView = {
  crafting: { stationItemId: "test-bench", kind: "crafting" },
  gathering: { stationItemId: "test-basket", kind: "production" },
};

const FIXTURE_CONTENT: CraftingContent = {
  registry: FIXTURE_RECIPES,
  jobRegistry: FIXTURE_JOBS,
  tuning: FIXTURE_TUNING,
};

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 100, cleanliness: 100, happiness: 100, energy: 100, ...overrides };
}

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "curious";
  return {
    id,
    speciesId: "mosspip",
    name: "Testpip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId,
      shiny: false,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: T0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.AssignedJob,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: T0,
    ...overrides,
  };
}

interface TestState extends CraftStateSlice {}

function makeState(overrides: Partial<TestState> = {}): TestState {
  const keep: KeepState = overrides.keep ?? {
    level: 1,
    placements: { "place-1": { itemId: "test-bench", x: 0, y: 0 } },
  };
  const jobs: JobsByPip = overrides.jobs ?? {
    "pip-1": {
      jobId: "crafting",
      stationPlacementId: "place-1",
      assignedAt: T0,
      lastProducedAt: T0,
    },
  };
  return {
    keep,
    jobs,
    pips: overrides.pips ?? { "pip-1": makePip("pip-1") },
    crafts: overrides.crafts ?? {},
    resources: overrides.resources ?? { wood: 10 },
    inventory: overrides.inventory ?? { berry: 10 },
    keepsakes: overrides.keepsakes ?? {},
  };
}

describe("effectiveCraftDurationMs (bible §3.6/§3.7)", () => {
  it("is the identity at level 1 with no building speed", () => {
    expect(effectiveCraftDurationMs(100_000, 1, 1, FIXTURE_TUNING)).toBe(100_000);
  });

  it("applies the Pip-level table", () => {
    expect(effectiveCraftDurationMs(100_000, 2, 1, FIXTURE_TUNING)).toBeCloseTo(95_000, 5);
    expect(effectiveCraftDurationMs(100_000, 3, 1, FIXTURE_TUNING)).toBeCloseTo(90_000, 5);
  });

  it("clamps the building multiplier at speedMin before multiplying", () => {
    // 0.5 is far below speedMin (0.9) — clamped to 0.9, not applied raw.
    expect(effectiveCraftDurationMs(100_000, 1, 0.5, FIXTURE_TUNING)).toBeCloseTo(90_000, 5);
  });

  it("never drops below the composite floor even at max theoretical speed", () => {
    // building 0.5→clamped 0.9, level table bottoms at 0.9 → naive 0.81,
    // but the floor (0.82) wins.
    expect(effectiveCraftDurationMs(100_000, 3, 0.5, FIXTURE_TUNING)).toBeCloseTo(82_000, 5);
  });
});

describe("enqueueCraft (bible §3.1–§3.4)", () => {
  it("starts immediately when the station is idle, spending resources exactly once", () => {
    const state = makeState({ resources: { wood: 10 } });
    const { state: next, outcome } = enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT);
    expect(outcome).toMatchObject({ ok: true, startedImmediately: true, pipId: "pip-1" });
    expect(next.resources.wood).toBe(8);
    expect(next.crafts["place-1"]).toEqual({
      pipId: "pip-1",
      recipeId: "quick",
      startedAt: T0,
      effectiveMs: 10 * 60_000,
      queue: [],
    });
  });

  it("spends BOTH resources and Satchel items in one bundle", () => {
    const state = makeState({ resources: { wood: 10 }, inventory: { berry: 10 } });
    const { state: next } = enqueueCraft(state, "place-1", "fancy", T0, FIXTURE_CONTENT);
    expect(next.resources.wood).toBe(9);
    expect(next.inventory.berry).toBe(7);
  });

  it("queues behind an in-flight order instead of starting a second one", () => {
    const state = makeState({ resources: { wood: 10 } });
    const started = enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT).state;
    const { state: next, outcome } = enqueueCraft(started, "place-1", "fancy", T0 + 5, FIXTURE_CONTENT);
    expect(outcome).toMatchObject({ ok: true, startedImmediately: false });
    // The ACTIVE order's own timing is untouched by the second request.
    expect(next.crafts["place-1"]).toMatchObject({
      recipeId: "quick",
      startedAt: T0,
      queue: ["fancy"],
    });
    // Inputs for the QUEUED recipe are spent immediately too (bible §3.4).
    expect(next.resources.wood).toBe(10 - 2 - 1);
    expect(next.inventory.berry).toBe(10 - 3);
  });

  it("refuses queueFull once the queue is at tuning.crafting.queueMax", () => {
    let state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    state = enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT).state; // queue: [quick]
    state = enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT).state; // queue: [quick, quick] (== queueMax 2)
    const before = state;
    const { state: next, outcome } = enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "queueFull" });
    expect(next).toBe(before); // refused — unchanged by reference
  });

  it("refuses cannotAfford, spending NOTHING, with a typed combined shortfall", () => {
    const state = makeState({ resources: { wood: 0 }, inventory: { berry: 1 } });
    const { state: next, outcome } = enqueueCraft(state, "place-1", "fancy", T0, FIXTURE_CONTENT);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "cannotAfford",
      missing: { wood: 1, berry: 2 },
    });
    expect(next).toBe(state); // nothing spent
  });

  it("refuses locked when the recipe's tier is not yet reached", () => {
    const state = makeState({ keep: { level: 1, placements: { "place-1": { itemId: "test-bench", x: 0, y: 0 } } } });
    const { outcome } = enqueueCraft(state, "place-1", "gated", T0, FIXTURE_CONTENT);
    expect(outcome).toMatchObject({ ok: false, reason: "locked" });
  });

  it("refuses unknownRecipe / unknownStation / unstaffed", () => {
    const state = makeState();
    expect(enqueueCraft(state, "place-1", "nope", T0, FIXTURE_CONTENT).outcome).toMatchObject({
      ok: false,
      reason: "unknownRecipe",
    });
    expect(enqueueCraft(state, "place-999", "quick", T0, FIXTURE_CONTENT).outcome).toMatchObject({
      ok: false,
      reason: "unknownStation",
    });
    const unstaffed = makeState({ jobs: {} });
    expect(enqueueCraft(unstaffed, "place-1", "quick", T0, FIXTURE_CONTENT).outcome).toMatchObject({
      ok: false,
      reason: "unstaffed",
    });
  });

  it("refuses unknownStation when the placed item hosts a DIFFERENT (non-crafting) job", () => {
    const state = makeState({
      keep: { level: 1, placements: { "place-1": { itemId: "test-basket", x: 0, y: 0 } } },
      jobs: {
        "pip-1": { jobId: "gathering", stationPlacementId: "place-1", assignedAt: T0, lastProducedAt: T0 },
      },
    });
    expect(enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT).outcome).toMatchObject({
      ok: false,
      reason: "unknownStation",
    });
  });
});

describe("cancelCraft (bible §3.4 — refunds honestly)", () => {
  it("cancelling the ACTIVE order refunds it in full and promotes the queued recipe with a FRESH effectiveMs", () => {
    let state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    state = enqueueCraft(state, "place-1", "fancy", T0, FIXTURE_CONTENT).state;
    const spentResources = state.resources.wood ?? 0;
    const spentBerry = state.inventory.berry ?? 0;

    const { state: next, outcome } = cancelCraft(state, "place-1", { kind: "active" }, T0 + 999, FIXTURE_CONTENT);
    expect(outcome).toMatchObject({ ok: true, recipeId: "quick" });
    expect(next.resources.wood).toBe(spentResources + 2); // quick's resources refunded
    expect(next.inventory.berry).toBe(spentBerry); // fancy's items untouched (still queued→promoted)
    expect(next.crafts["place-1"]).toMatchObject({
      recipeId: "fancy",
      startedAt: T0 + 999, // NEW start time, not the original enqueue time
      queue: [],
    });
  });

  it("cancelling a QUEUED entry refunds just that one and leaves the active order untouched", () => {
    let state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    state = enqueueCraft(state, "place-1", "fancy", T0, FIXTURE_CONTENT).state;
    const before = state.crafts["place-1"];

    const { state: next, outcome } = cancelCraft(
      state,
      "place-1",
      { kind: "queued", index: 0 },
      T0 + 5,
      FIXTURE_CONTENT,
    );
    expect(outcome).toMatchObject({ ok: true, recipeId: "fancy" });
    expect(next.inventory.berry).toBe((state.inventory.berry ?? 0) + 3); // fancy's berries back
    expect(next.crafts["place-1"]).toMatchObject({
      recipeId: before?.recipeId,
      startedAt: before?.startedAt,
      queue: [],
    });
  });

  it("cancelling the ACTIVE order with an empty queue clears the station entirely", () => {
    const state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    const { state: next } = cancelCraft(state, "place-1", { kind: "active" }, T0 + 1, FIXTURE_CONTENT);
    expect(next.crafts["place-1"]).toBeUndefined();
    expect(next.resources.wood).toBe(10);
  });

  it("refuses notCrafting / badIndex", () => {
    const state = makeState();
    expect(cancelCraft(state, "place-1", { kind: "active" }, T0, FIXTURE_CONTENT).outcome).toMatchObject({
      ok: false,
      reason: "notCrafting",
    });
    const withOne = enqueueCraft(state, "place-1", "quick", T0, FIXTURE_CONTENT).state;
    expect(
      cancelCraft(withOne, "place-1", { kind: "queued", index: 0 }, T0, FIXTURE_CONTENT).outcome,
    ).toMatchObject({ ok: false, reason: "badIndex" });
  });
});

describe("refundCraftsAtStation (REMOVE_ITEM's own rule, bible §3.4)", () => {
  it("refunds the active order AND every queued recipe, then drops the station", () => {
    let state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    state = enqueueCraft(state, "place-1", "fancy", T0, FIXTURE_CONTENT).state;
    const next = refundCraftsAtStation(state, "place-1", FIXTURE_CONTENT);
    expect(next.resources.wood).toBe(10);
    expect(next.inventory.berry).toBe(10);
    expect(next.crafts["place-1"]).toBeUndefined();
  });

  it("is a no-op (by reference) for a station with nothing crafting", () => {
    const state = makeState();
    expect(refundCraftsAtStation(state, "place-1", FIXTURE_CONTENT)).toBe(state);
  });
});

describe("settleCraftCompletions (the LIVE/TICK path)", () => {
  it("grants an item output exactly at the completion moment, then, and clears the station", () => {
    const state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    const early = settleCraftCompletions(state, T0 + 10 * 60_000 - 1, FIXTURE_CONTENT);
    expect(early.completions).toEqual([]);
    expect(early.state.crafts["place-1"]).toBeDefined();

    const due = settleCraftCompletions(state, T0 + 10 * 60_000, FIXTURE_CONTENT);
    expect(due.completions).toHaveLength(1);
    expect(due.completions[0]).toMatchObject({ recipeId: "quick", pipId: "pip-1" });
    expect(due.state.inventory.gizmo).toBe(1);
    expect(due.state.crafts["place-1"]).toBeUndefined();
  });

  it("grants a keepsake output to state.keepsakes, never state.inventory", () => {
    const state = enqueueCraft(makeState(), "place-1", "shelfPiece", T0, FIXTURE_CONTENT).state;
    const { state: settled } = settleCraftCompletions(state, T0 + 15 * 60_000, FIXTURE_CONTENT);
    expect(settled.keepsakes["test-shelf-thing"]).toBe(1);
    expect(settled.inventory["test-shelf-thing"]).toBeUndefined();
  });

  it("chains through the queue within a single long tick, promoting the next recipe", () => {
    let state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    state = enqueueCraft(state, "place-1", "fancy", T0, FIXTURE_CONTENT).state;
    const { state: settled, completions } = settleCraftCompletions(
      state,
      T0 + 10 * 60_000 + 20 * 60_000,
      FIXTURE_CONTENT,
    );
    expect(completions.map((c) => c.recipeId)).toEqual(["quick", "fancy"]);
    expect(settled.inventory.gizmo).toBe(1);
    expect(settled.inventory.trinket).toBe(2);
    expect(settled.crafts["place-1"]).toBeUndefined();
  });

  it("STOPS at the boundary a Pip leaves AssignedJob — the craft neither completes nor is lost", () => {
    const state = enqueueCraft(makeState(), "place-1", "quick", T0, FIXTURE_CONTENT).state;
    const sulking: TestState = {
      ...state,
      pips: { "pip-1": { ...state.pips["pip-1"], activity: PipActivity.Sulking } as PipState },
    };
    const { state: settled, completions } = settleCraftCompletions(
      sulking,
      T0 + 10 * 60_000 + 1,
      FIXTURE_CONTENT,
    );
    expect(completions).toEqual([]);
    // Nothing granted, nothing lost — the order is exactly as it was.
    expect(settled.crafts["place-1"]).toEqual(sulking.crafts["place-1"]);
    expect(settled.inventory.gizmo).toBeUndefined();
  });
});

describe("collectCraftCatchupEvents + shiftCraftsPastFreeze (offline, spec §4.5)", () => {
  interface CatchupTestState extends CraftCatchupState {}

  function makeCatchupState(overrides: Partial<CatchupTestState> = {}): CatchupTestState {
    return {
      pips: overrides.pips ?? [makePip("pip-1")],
      jobs: overrides.jobs ?? {
        "pip-1": { jobId: "crafting", stationPlacementId: "place-1", assignedAt: T0, lastProducedAt: T0 },
      },
      crafts: overrides.crafts ?? {},
      inventory: overrides.inventory ?? {},
      keepsakes: overrides.keepsakes ?? {},
      firedCraftCompletions: [],
    };
  }

  it("fires a completion that falls INSIDE the rate cap, granting output via apply()", () => {
    const crafts: CraftsByStation = {
      "place-1": { pipId: "pip-1", recipeId: "quick", startedAt: T0, effectiveMs: 10 * 60_000, queue: [] },
    };
    const state = makeCatchupState({ crafts });
    const events = collectCraftCatchupEvents(
      state,
      T0,
      T0 + 60 * 60_000,
      { offlineRateCapMs: 16 * 60 * 60_000, crafting: FIXTURE_TUNING },
      { registry: FIXTURE_RECIPES },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.at).toBe(T0 + 10 * 60_000);
    const applied = (events[0] as { apply: (s: CatchupTestState) => CatchupTestState }).apply(state);
    expect(applied.inventory.gizmo).toBe(1);
    expect(applied.crafts["place-1"]).toBeUndefined();
    expect(applied.firedCraftCompletions).toHaveLength(1);
  });

  it("does NOT fire a completion that falls PAST the offline rate cap — crafting is a rate, not a timer", () => {
    const crafts: CraftsByStation = {
      // A 90-minute recipe, but the cap is only 30 minutes.
      "place-1": { pipId: "pip-1", recipeId: "fancy", startedAt: T0, effectiveMs: 90 * 60_000, queue: [] },
    };
    const state = makeCatchupState({ crafts });
    const events = collectCraftCatchupEvents(
      state,
      T0,
      T0 + 5 * 60 * 60_000, // plenty of real elapsed time
      { offlineRateCapMs: 30 * 60_000, crafting: FIXTURE_TUNING }, // but the cap is tiny
      { registry: FIXTURE_RECIPES },
    );
    expect(events).toEqual([]); // never scheduled — completion is past ratedEnd
  });

  it("a completion event no-ops (never fires) if its station's Pip is no longer AssignedJob", () => {
    const crafts: CraftsByStation = {
      "place-1": { pipId: "pip-1", recipeId: "quick", startedAt: T0, effectiveMs: 10 * 60_000, queue: [] },
    };
    const state = makeCatchupState({
      crafts,
      pips: [makePip("pip-1", { activity: PipActivity.Sulking })],
    });
    const events = collectCraftCatchupEvents(
      state,
      T0,
      T0 + 60 * 60_000,
      { offlineRateCapMs: 16 * 60 * 60_000, crafting: FIXTURE_TUNING },
      { registry: FIXTURE_RECIPES },
    );
    expect(events).toHaveLength(1); // still SCHEDULED (unknown at collection time)…
    const applied = (events[0] as { apply: (s: CatchupTestState) => CatchupTestState }).apply(state);
    expect(applied).toBe(state); // …but a no-op: nothing granted, nothing advanced
  });

  it("shiftCraftsPastFreeze slides the active order's startedAt past the frozen tail, never backfilling it", () => {
    const crafts: CraftsByStation = {
      "place-1": { pipId: "pip-1", recipeId: "quick", startedAt: T0, effectiveMs: 10 * 60_000, queue: ["fancy"] },
    };
    const shifted = shiftCraftsPastFreeze(crafts, 5 * 60_000);
    expect(shifted["place-1"]?.startedAt).toBe(T0 + 5 * 60_000);
    expect(shifted["place-1"]?.effectiveMs).toBe(10 * 60_000); // duration itself is untouched
    expect(shifted["place-1"]?.queue).toEqual(["fancy"]);
  });

  it("is a no-op for a zero/negative cappedMs or an empty crafts map", () => {
    const crafts: CraftsByStation = {
      "place-1": { pipId: "pip-1", recipeId: "quick", startedAt: T0, effectiveMs: 10 * 60_000, queue: [] },
    };
    expect(shiftCraftsPastFreeze(crafts, 0)).toBe(crafts);
    expect(shiftCraftsPastFreeze({}, 5000)).toEqual({});
  });
});

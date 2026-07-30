/**
 * ROUND 2F — THE DAY-2 CARE BAR (the pure half).
 *
 * Measured on a 14h and a 20h return with a Pip clocked in at the Gathering
 * Station: Feed / Clean / Play / Pet / Rest all disabled at opacity 0.45, with
 * no explanation on the bar and no tap affordance. The header read "Pip1 —
 * Lazy — gathering away" but the greyed buttons said nothing, so the tap count
 * from cold open to a care action was THREE — "Come in", then another Pip's
 * portrait in the roster strip (discoverable only by tapping a dead button and
 * getting nothing), then Feed.
 *
 * Staffing a station before you close the app is the behaviour the game
 * teaches, so this is the DEFAULT day-2 state, not an edge case. Both halves of
 * the fix are pure functions and both are pinned here; the pill itself is dumb
 * DOM around them (the topBar.test.ts convention).
 */

import { describe, expect, it } from "vitest";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import { createNewGame } from "../core/state";
import type { GameState } from "../core/state";
import { careUnavailableReason, firstCareablePipId, firstStockedFoodId } from "./actionBar";

const T0 = 1_000_000;

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 70,
  cleanliness: 70,
  happiness: 70,
  energy: 70,
  ...overrides,
});

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  return {
    id,
    speciesId: "mosspip",
    name: id === "pip-1" ? "Mossy" : "Fern",
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
    ...overrides,
  } as PipState;
}

/** A two-Pip roster, so "switch to someone free" has somewhere to go. */
function roster(
  activeActivity: PipActivity,
  otherActivity: PipActivity = PipActivity.Idle,
): GameState {
  const base = createNewGame(7, T0);
  return {
    ...base,
    activePipId: "pip-1",
    rosterOrder: ["pip-1", "pip-2"],
    pips: {
      "pip-1": makePip("pip-1", { activity: activeActivity }),
      "pip-2": makePip("pip-2", { activity: otherActivity }),
    },
  };
}

describe("careUnavailableReason — says WHY the bar is grey, warmly", () => {
  it("is null when the Pip can be cared for (Idle)", () => {
    expect(careUnavailableReason(makePip("pip-1"))).toBeNull();
  });

  it("is null while Resting — a napping Pip can still be fussed over", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.Resting })),
    ).toBeNull();
  });

  it("names WORKING — the default day-2 state, and the one that used to say nothing", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.AssignedJob })),
    ).toBe("Mossy is busy working.");
  });

  it("names the trail while OnExpedition", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.OnExpedition })),
    ).toBe("Mossy is out on the trail.");
  });

  it("names the way home while Returning", () => {
    expect(
      careUnavailableReason(makePip("pip-1", { activity: PipActivity.Returning })),
    ).toBe("Mossy is on the way home.");
  });

  it("never blames the player — no reason contains 'you' or a scolding word", () => {
    for (const activity of [
      PipActivity.AssignedJob,
      PipActivity.OnExpedition,
      PipActivity.Returning,
    ]) {
      const why = careUnavailableReason(makePip("pip-1", { activity })) ?? "";
      expect(why.length).toBeGreaterThan(8);
      expect(why.toLowerCase()).not.toMatch(/\byou\b|should|forgot|failed|neglect/);
    }
  });
});

describe("firstCareablePipId — the one-tap way out", () => {
  it("finds a free Pip while the active one is working", () => {
    expect(firstCareablePipId(roster(PipActivity.AssignedJob))).toBe("pip-2");
  });

  it("never returns the ACTIVE Pip, even when that Pip is free", () => {
    expect(firstCareablePipId(roster(PipActivity.Idle))).toBe("pip-2");
    const soloIdle = roster(PipActivity.Idle, PipActivity.OnExpedition);
    expect(firstCareablePipId(soloIdle)).toBeNull();
  });

  it("is null when EVERY other Pip is also busy — the pill then just explains", () => {
    expect(
      firstCareablePipId(roster(PipActivity.AssignedJob, PipActivity.OnExpedition)),
    ).toBeNull();
  });

  it("respects roster ORDER, not object key order", () => {
    const state = roster(PipActivity.AssignedJob);
    const reordered: GameState = { ...state, rosterOrder: ["pip-2", "pip-1"] };
    expect(firstCareablePipId(reordered)).toBe("pip-2");
  });

  it("a Resting Pip counts as available (care is legal while napping)", () => {
    expect(
      firstCareablePipId(roster(PipActivity.AssignedJob, PipActivity.Resting)),
    ).toBe("pip-2");
  });

  it("a single-Pip roster has nowhere to switch", () => {
    const base = createNewGame(7, T0);
    const solo: GameState = {
      ...base,
      activePipId: "pip-1",
      rosterOrder: ["pip-1"],
      pips: { "pip-1": makePip("pip-1", { activity: PipActivity.AssignedJob }) },
    };
    expect(firstCareablePipId(solo)).toBeNull();
  });
});

describe("firstStockedFoodId — unchanged, pinned alongside", () => {
  it("returns null on an empty satchel and the first stocked food otherwise", () => {
    const base = createNewGame(7, T0);
    expect(firstStockedFoodId({ ...base, inventory: {} })).toBeNull();
    expect(firstStockedFoodId({ ...base, inventory: { berry: 2 } })).toBe("berry");
  });
});

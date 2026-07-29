/**
 * "While you were away…" — pure derivation tests (node): the sheet's
 * whole story is derived from a CatchupSummary + state slices, so every
 * copy decision (arrows not doom, destination names, the Pipping tease,
 * the loot tease, the capped-time note) is pinned here.
 */

import { describe, expect, it } from "vitest";
import type {
  CatchupFiredEvent,
  CatchupSummary,
  PipCatchupDelta,
} from "../core/pips/catchup";
import type { NeedId, PipNeeds, PipState } from "../core/pips/types";
import { LifeStage, PipActivity } from "../core/pips/types";
import { HOUR_MS, MINUTE_MS, tuning } from "../content/tuning";
import {
  AWAY_SHEET_MIN_ELAPSED_MS,
  deriveAwaySheet,
  elapsedLabel,
} from "./awaySheet";

/** Full `PipState` fixture — `AwaySheetStateView.pips` needs the real
 * shape (not just `{ name }`) so the sulking note can read `isSulking`. */
function pip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    name: "Moss",
    speciesId: "mosspip",
    personalityId: "curious",
    genome: {
      speciesId: "mosspip",
      palette: "meadow",
      pattern: "speckled",
      accessorySlots: [],
      personality: "curious",
      shiny: false,
    },
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
    evolved: null,
    sulking: false,
    ...overrides,
  } as PipState;
}

const STATE = {
  pips: {
    "pip-1": pip({ id: "pip-1", name: "Moss" }),
    "pip-2": pip({ id: "pip-2", name: "Wren" }),
  },
  pendingReveals: [] as readonly unknown[],
};

function needs(value = 80): PipNeeds {
  return { hunger: value, cleanliness: value, happiness: value, energy: value };
}

function pipDelta(overrides: Partial<PipCatchupDelta> = {}): PipCatchupDelta {
  return {
    pipId: "pip-1",
    activityBefore: PipActivity.Idle,
    activityAfter: PipActivity.Idle,
    needsBefore: needs(),
    needsAfter: needs(),
    needsDelta: { hunger: 0, cleanliness: 0, happiness: 0, energy: 0 },
    ...overrides,
  };
}

function summary(overrides: Partial<CatchupSummary> = {}): CatchupSummary {
  return {
    elapsedMs: 3 * HOUR_MS,
    ratedMs: 3 * HOUR_MS,
    cappedMs: 0,
    events: [],
    pips: [pipDelta()],
    ...overrides,
  };
}

describe("threshold — quick absences are not news", () => {
  it("returns null under AWAY_SHEET_MIN_ELAPSED_MS", () => {
    expect(
      deriveAwaySheet(summary({ elapsedMs: AWAY_SHEET_MIN_ELAPSED_MS - 1 }), STATE),
    ).toBeNull();
  });

  it("returns a model at the threshold and above", () => {
    expect(
      deriveAwaySheet(summary({ elapsedMs: AWAY_SHEET_MIN_ELAPSED_MS }), STATE),
    ).not.toBeNull();
  });
});

describe("per-pip needs deltas — arrows, not doom", () => {
  it("rounds deltas and reports direction per need", () => {
    const model = deriveAwaySheet(
      summary({
        pips: [
          pipDelta({
            needsDelta: {
              hunger: -18.4,
              cleanliness: -0.4,
              happiness: 4.6,
              energy: -1,
            },
          }),
        ],
      }),
      STATE,
    );
    const lines = model!.pips[0]!.needLines;
    expect(lines.map((l) => [l.needId, l.direction, l.amount])).toStrictEqual([
      ["hunger", "down", 18],
      ["happiness", "up", 5],
      ["energy", "down", 1],
    ]);
    expect(model!.pips[0]!.name).toBe("Moss");
    expect(model!.pips[0]!.note).toBeNull();
  });

  it("sub-point drift is dropped; an unchanged pip gets the cozy note", () => {
    const model = deriveAwaySheet(
      summary({
        pips: [
          pipDelta({
            needsDelta: { hunger: -0.3, cleanliness: 0.2, happiness: 0, energy: 0 },
          }),
        ],
      }),
      STATE,
    );
    expect(model!.pips[0]!.needLines).toHaveLength(0);
    expect(model!.pips[0]!.note).toContain("dozed");
  });

  it("a pip that landed Sulking gets the warm aside, never doom", () => {
    const model = deriveAwaySheet(
      summary({
        pips: [
          pipDelta({
            activityAfter: PipActivity.Sulking,
            needsDelta: { hunger: -40, cleanliness: -10, happiness: -30, energy: -5 },
          }),
        ],
      }),
      { ...STATE, pips: { ...STATE.pips, "pip-1": pip({ activity: PipActivity.Sulking }) } },
    );
    expect(model!.pips[0]!.note).toContain("sulky");
    expect(model!.pips[0]!.note).toContain("snack");
  });

  // Round 2A made sulking a flag orthogonal to activity: a pip can nap
  // through a sulk, keeping activity === Resting. Reading activityAfter
  // would show generic copy and quietly under-report the sulk. The sheet
  // reads sulking-ness off the pip's current state (`isSulking`), not off
  // `delta.activityAfter`, so a Resting-but-sulking pip must be reflected
  // in the state passed alongside the delta.
  it("a pip that landed Resting-while-sulking still gets the sulky aside", () => {
    const model = deriveAwaySheet(
      summary({
        pips: [
          pipDelta({
            activityAfter: PipActivity.Resting,
            needsDelta: { hunger: -40, cleanliness: -10, happiness: -30, energy: 20 },
          }),
        ],
      }),
      {
        ...STATE,
        pips: {
          ...STATE.pips,
          "pip-1": pip({ activity: PipActivity.Resting, sulking: true }),
        },
      },
    );
    expect(model!.pips[0]!.note).toContain("sulky");
  });

  it("a sulking pip whose needs did not move is never told it dozed through", () => {
    const model = deriveAwaySheet(
      summary({
        pips: [
          pipDelta({
            activityAfter: PipActivity.Resting,
            needsDelta: { hunger: 0, cleanliness: 0, happiness: 0, energy: 0 },
          }),
        ],
      }),
      {
        ...STATE,
        pips: {
          ...STATE.pips,
          "pip-1": pip({ activity: PipActivity.Resting, sulking: true }),
        },
      },
    );
    expect(model!.pips[0]!.needLines).toHaveLength(0);
    expect(model!.pips[0]!.note).toContain("sulky");
    expect(model!.pips[0]!.note).not.toContain("dozed");
  });
});

describe("story lines — expeditions, eggs, loot, the cap", () => {
  const returnEvent = (
    pipId: string,
    expeditionId: string,
  ): CatchupFiredEvent => ({
    kind: "expeditionReturn",
    at: 1_000,
    pipId,
    expedition: { expeditionId, departedAt: 0, durationMs: 1_000 },
  });

  it("names the pip and the destination for each completed expedition", () => {
    const model = deriveAwaySheet(
      summary({ events: [returnEvent("pip-2", "forest")] }),
      STATE,
    );
    expect(model!.expeditionLines).toStrictEqual([
      "Wren finished the Forest trip.",
    ]);
  });

  it("an expedition id missing from the registry falls back to a capitalized id", () => {
    const model = deriveAwaySheet(
      summary({ events: [returnEvent("pip-1", "swamp")] }),
      STATE,
    );
    expect(model!.expeditionLines[0]).toBe("Moss finished the Swamp trip.");
  });

  it("eggs that came due get the Pipping tease, singular and plural", () => {
    const egg = (at: number): CatchupFiredEvent => ({
      kind: "custom",
      at,
      tag: "eggReady",
    });
    const one = deriveAwaySheet(summary({ events: [egg(1)] }), STATE);
    expect(one!.eggLine).toContain("tapping from inside");
    const two = deriveAwaySheet(summary({ events: [egg(1), egg(2)] }), STATE);
    expect(two!.eggLine).toContain("2 eggs");
    expect(deriveAwaySheet(summary(), STATE)!.eggLine).toBeNull();
  });

  it("teases the waiting loot by pouch count without spoiling contents", () => {
    const model = deriveAwaySheet(summary(), {
      ...STATE,
      pendingReveals: [{}, {}],
    });
    expect(model!.lootLine).toBe("2 unopened loot pouches are waiting.");
    expect(model!.lootLine).not.toContain("berry");
    expect(deriveAwaySheet(summary(), STATE)!.lootLine).toBeNull();
  });

  it("notes the rate cap (with the tuned hour count) only when it engaged", () => {
    const capped = deriveAwaySheet(
      summary({
        elapsedMs: 30 * HOUR_MS,
        ratedMs: tuning.offlineRateCapMs,
        cappedMs: 30 * HOUR_MS - tuning.offlineRateCapMs,
      }),
      STATE,
    );
    const hours = Math.round(tuning.offlineRateCapMs / HOUR_MS);
    expect(capped!.cappedLine).toContain(`${hours} hours`);
    expect(capped!.cappedLine).toContain("insisted");
    expect(deriveAwaySheet(summary(), STATE)!.cappedLine).toBeNull();
  });
});

describe("elapsed copy", () => {
  it("humanizes minutes, hours, and days", () => {
    expect(elapsedLabel(5 * MINUTE_MS)).toBe("5 minutes");
    expect(elapsedLabel(3 * HOUR_MS)).toBe("about 3 hours");
    expect(elapsedLabel(72 * HOUR_MS)).toBe("3 days");
  });

  it("the headline embeds the elapsed label", () => {
    const model = deriveAwaySheet(summary({ elapsedMs: 3 * HOUR_MS }), STATE);
    expect(model!.elapsedLine).toBe(
      "You were gone about 3 hours. The Keep kept busy.",
    );
  });
});

/** Guard: every need id in the model maps to a label (content drift). */
describe("need coverage", () => {
  it("emits a line for every need when all four move", () => {
    const model = deriveAwaySheet(
      summary({
        pips: [
          pipDelta({
            needsDelta: { hunger: -5, cleanliness: -6, happiness: -7, energy: -8 },
          }),
        ],
      }),
      STATE,
    );
    const ids = model!.pips[0]!.needLines.map((l) => l.needId);
    expect(ids).toStrictEqual<NeedId[]>([
      "hunger",
      "cleanliness",
      "happiness",
      "energy",
    ]);
  });
});

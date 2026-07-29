/**
 * Focus-view job row tests (spec §6.2 Gathering UX) — the PURE
 * `buildJobRows` model: no station → no rows, occupancy (one pip per
 * station), assigned/unassign states, structural away/resting notes, and
 * the rule that Sulking pips KEEP a live Clock in button (the refusal is
 * the pip's to voice — spec §4.4/§4.7). DOM untested chrome, as ever.
 */

import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "../content/tuning";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { GameState } from "../core/state";
import { buildFocusModel, buildJobRows } from "./focusView";

const needs = (): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mosspip",
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
    inventory: {},
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
    ...overrides,
  };
}

/** A keep with one Gathering Station placed as "place-1". */
const stationKeep = {
  level: 1,
  placements: { "place-1": { itemId: "gathering-station", x: 1, y: 1 } },
};

const rows = (state: GameState) => {
  const pip = state.pips[state.activePipId];
  if (pip === undefined) throw new Error("active pip missing");
  return buildJobRows(state, pip);
};

describe("buildJobRows — station discovery (spec §6.2 registry seam)", () => {
  it("no placed station → no rows (and no Work section)", () => {
    expect(rows(makeState())).toHaveLength(0);
    // Decorations never host jobs.
    const decorated = makeState({
      keep: {
        level: 1,
        placements: { "place-1": { itemId: "moss-tuft", x: 0, y: 0 } },
      },
    });
    expect(rows(decorated)).toHaveLength(0);
  });

  it("a placed Gathering Station appears with its cadence", () => {
    const state = makeState({ keep: stationKeep });
    const built = rows(state);
    expect(built).toHaveLength(1);
    expect(built[0]?.stationName).toBe("Gathering Station");
    expect(built[0]?.jobName).toBe("Gathering");
    expect(built[0]?.cadenceLabel).toBe("every 10 min");
    expect(built[0]?.status).toBe("available");
    expect(built[0]?.assignable).toBe(true);
  });
});

describe("buildJobRows — occupancy + this pip's shift", () => {
  const job = {
    jobId: "gathering",
    stationPlacementId: "place-1",
    assignedAt: 0,
    lastProducedAt: 0,
  };

  it("this pip assigned → unassignable row with the working note", () => {
    const pip = makePip({ activity: PipActivity.AssignedJob });
    const state = makeState({
      pip,
      keep: stationKeep,
      jobs: { [pip.id]: job },
    });
    const built = rows(state);
    expect(built[0]?.status).toBe("assigned");
    expect(built[0]?.unassignable).toBe(true);
    expect(built[0]?.assignable).toBe(false);
    expect(built[0]?.note).toContain("Mosspip is gathering away");
  });

  it("another pip's station shows who has it covered", () => {
    const worker = makePip({
      id: "pip-2",
      name: "Fernpip",
      activity: PipActivity.AssignedJob,
    });
    const me = makePip();
    const state = makeState({
      pip: me,
      pips: { [me.id]: me, [worker.id]: worker },
      rosterOrder: [me.id, worker.id],
      keep: stationKeep,
      jobs: { [worker.id]: job },
    });
    const built = buildJobRows(state, me);
    expect(built[0]?.status).toBe("occupied");
    expect(built[0]?.assignable).toBe(false);
    expect(built[0]?.note).toContain("Fernpip has this one covered");
  });

  it("a pip already working elsewhere is not offered a second station", () => {
    const me = makePip({ activity: PipActivity.AssignedJob });
    const state = makeState({
      pip: me,
      keep: {
        level: 1,
        placements: {
          "place-1": { itemId: "gathering-station", x: 1, y: 1 },
          "place-2": { itemId: "gathering-station", x: 4, y: 4 },
        },
      },
      jobs: { [me.id]: job },
    });
    const built = rows(state);
    const other = built.find((r) => r.stationPlacementId === "place-2");
    expect(other?.status).toBe("workingElsewhere");
    expect(other?.assignable).toBe(false);
  });
});

describe("buildJobRows — structural notes vs pip-voiced refusals", () => {
  it("away and resting pips get warm structural notes, no button", () => {
    const away = makeState({
      pip: makePip({
        activity: PipActivity.OnExpedition,
        expedition: {
          expeditionId: "meadow",
          departedAt: 0,
          durationMs: 5 * MINUTE_MS,
        },
      }),
      keep: stationKeep,
    });
    expect(rows(away)[0]?.status).toBe("away");
    expect(rows(away)[0]?.assignable).toBe(false);

    const resting = makeState({
      pip: makePip({ activity: PipActivity.Resting }),
      keep: stationKeep,
    });
    expect(rows(resting)[0]?.status).toBe("resting");
    expect(rows(resting)[0]?.assignable).toBe(false);
  });

  it("Sulking pips KEEP the Clock in button — core voices the refusal", () => {
    const state = makeState({
      pip: makePip({ activity: PipActivity.Sulking }),
      keep: stationKeep,
    });
    expect(rows(state)[0]?.status).toBe("available");
    expect(rows(state)[0]?.assignable).toBe(true);
  });
});

describe("buildFocusModel carries the job rows", () => {
  it("focus model includes jobs when a station is placed", () => {
    const state = makeState({ keep: stationKeep });
    const model = buildFocusModel(state, "pip-1", 0);
    expect(model?.jobs).toHaveLength(1);
    expect(buildFocusModel(makeState(), "pip-1", 0)?.jobs).toHaveLength(0);
  });
});

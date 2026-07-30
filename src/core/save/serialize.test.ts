/**
 * Save envelope tests (spec §8, §2 rule 3 — the Phase 2 save gate):
 *
 * - DEEP-EQUAL round-trip: rich GameState (multiple pips, touched rng
 *   streams, mid-tick cooldowns, sulking pip, pipling, active
 *   expedition) → toSaveBlob → JSON wire → fromSaveBlob → strict deep
 *   equal, "save/reload preserves state exactly".
 * - RNG continuation: 5 draws pre-save, save, then the restored rng and
 *   the original produce identical next-5 draws — reloading never
 *   re-rolls or skips an outcome.
 * - fromSaveBlob is a never-throwing trust boundary: a matrix of
 *   malformed blobs each yields a typed SaveBlobError with a useful
 *   path, and a hostile-input battery proves nothing escapes as a raw
 *   throw.
 */

import { describe, expect, it } from "vitest";
import { createRng, createRngFromState } from "../rng";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipNeeds, PipState } from "../pips/types";
import type { GameState } from "../state";
import {
  CURRENT_SCHEMA_VERSION,
  fromSaveBlob,
  toSaveBlob,
} from "./serialize";
import type { SaveBlob, SaveBlobError } from "./serialize";

const SAVED_AT = 90_000_000;
const SEED = 20_260_729;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 80, cleanliness: 75, happiness: 66.5, energy: 90, ...overrides };
}

function makePip(id: string, overrides: Partial<PipState> = {}): PipState {
  return {
    id,
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
    ageMs: SAVED_AT,
    happinessIntegral: 0.75 * SAVED_AT * 100,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    sulking: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: SAVED_AT,
    ...overrides,
  };
}

/**
 * A mid-play GameState exercising every serialized corner: an adult out
 * on an expedition with mid-tick cooldowns, a pipling, a sulking pip
 * (happiness 0), several touched rng streams with different cursor
 * positions, inventory/resources, no-repeat dialogue memory, and a
 * populated lastCareOutcome transient.
 */
function richState(seed = SEED): GameState {
  const rng = createRng(seed);
  const dialogue = rng.stream("dialogue");
  dialogue.next();
  dialogue.next();
  dialogue.next();
  rng.stream("quirks").next();
  const loot = rng.stream("expedition-loot");
  loot.next();
  loot.next();
  rng.stream("genesis").next();

  const explorer = makePip("pip-1", {
    activity: PipActivity.OnExpedition,
    lastGiftItemId: "shiny-pebble",
    expedition: {
      expeditionId: "mossy-hollow",
      departedAt: SAVED_AT - 600_000,
      durationMs: 1_800_000,
    },
    pendingSulk: true,
  });
  const pipling = makePip("pip-2", {
    name: "Sprout",
    personalityId: "clingy",
    lifeStage: LifeStage.Pipling,
    hatchedAt: SAVED_AT - 7_200_000,
    ageMs: 7_200_000,
    happinessIntegral: 7_200_000 * 80,
  });
  const sulker = makePip("pip-3", {
    name: "Grump",
    personalityId: "lazy",
    activity: PipActivity.Sulking,
    sulking: true,
    needs: needs({ happiness: 0, hunger: 12.25 }),
  });

  return {
    pips: { "pip-1": explorer, "pip-2": pipling, "pip-3": sulker },
    rosterOrder: ["pip-1", "pip-2", "pip-3"],
    activePipId: "pip-2",
    inventory: { berry: 2, stew: 1 },
    resources: { moss: 5, pebble: 12 },
    rngState: rng.getState(),
    seed,
    keep: {
      level: 2,
      placements: {
        "place-1": { itemId: "gathering-station", x: 2, y: 3 },
        "place-2": { itemId: "cozy-lantern", x: 0, y: 0 },
      },
    },
    jobs: {
      "pip-2": {
        jobId: "gathering",
        stationPlacementId: "place-1",
        assignedAt: SAVED_AT - 1_200_000,
        lastProducedAt: SAVED_AT - 600_000,
      },
    },
    rosterUpgradePurchased: false,
    eggs: [
      {
        id: "egg-1",
        state: "incubating",
        foundAt: SAVED_AT - 3_600_000,
        rarity: "common",
        incubationMs: 7_200_000,
        incubationStartedAt: SAVED_AT - 3_500_000,
        sourceExpeditionId: "forest",
      },
      {
        id: "egg-2",
        state: "pipping",
        foundAt: SAVED_AT - 9_000_000,
        rarity: "rare",
        incubationMs: 7_200_000,
        incubationStartedAt: SAVED_AT - 8_900_000,
        sourceExpeditionId: null,
      },
    ],
    pendingReveals: [
      {
        pipId: "pip-1",
        expeditionId: "mossy-hollow",
        completedAt: SAVED_AT - 60_000,
        items: ["berry", "fiber", "berry"],
        egg: {
          id: "egg-3",
          state: "found",
          foundAt: SAVED_AT - 60_000,
          rarity: "common",
          incubationMs: 7_200_000,
          incubationStartedAt: null,
          sourceExpeditionId: "mossy-hollow",
        },
      },
    ],
    nextPipNumber: 4,
    nextEggNumber: 4,
    nextPlacementNumber: 3,
    cooldowns: {
      "pip-1": { clean: SAVED_AT - 30_000, pet: SAVED_AT - 10_000 },
      "pip-3": { pet: SAVED_AT - 29_999 },
    },
    lastLineIndex: {
      "pip-1": { content: 1, refusal: 0 },
      "pip-3": { sulking: 2 },
    },
    createdAt: 0,
    lastTickAt: SAVED_AT,
    lastCareOutcome: {
      action: "pet",
      pipId: "pip-1",
      at: SAVED_AT - 10_000,
      applied: true,
      dialogueContext: "content",
      lineId: "curious/content/1",
      line: "placeholder",
    },
    lastCatchup: null,
    lastAssignOutcome: {
      ok: true,
      pipId: "pip-1",
      expeditionId: "mossy-hollow",
      departedAt: SAVED_AT - 600_000,
      durationMs: 1_800_000,
      returnAt: SAVED_AT + 1_200_000,
    },
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
    // ROUND 2C — the progression stack (docs/retention-bible.md),
    // exercised with real, non-trivial data so the round-trip test
    // actually covers every new field's shape.
    streak: {
      current: 4,
      longest: 9,
      lastVisitDay: 12,
      totalVisitDays: 15,
      graceBanked: 1,
      graceRefilledOnDay: 5,
      rainDays: 2,
      rewardedForDay: 4,
      pendingChoices: [{ kind: "keepsake", offers: ["welcome-sign", "moss-tuft"], forDay: 5 }],
    },
    dayOffsetMs: 4 * 60 * 60 * 1000,
    counters: { feeds: 12, careActions: 30, expeditionsTotal: 5 },
    milestones: {
      earned: { "first-feed": SAVED_AT - 1000 },
      pendingCelebrations: ["first-trip-home"],
    },
    bounties: {
      day: 3,
      slots: [
        {
          templateId: "hand-out-snacks",
          slot: 0,
          target: 4,
          progress: 2,
          completedAt: null,
          rerolled: false,
          params: {},
          stale: false,
        },
      ],
      rerollsUsed: 1,
      dayBonusGranted: false,
    },
    eggPity: { meadow: 3, lanterngrotto: 5 },
    activeEvents: ["berry-glut"],
    keepsakes: { "moss-tuft": 1 },
    flair: {},
  };
}

/** JSON wire trip — exactly what IndexedDB export/import (§8) sees. */
function overWire(blob: SaveBlob): unknown {
  return JSON.parse(JSON.stringify(blob)) as unknown;
}

function mustLoad(value: unknown): SaveBlob {
  const result = fromSaveBlob(value);
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code} at "${result.error.path}": ${result.error.message}`);
  }
  return result.save;
}

function mustFail(value: unknown): SaveBlobError {
  const result = fromSaveBlob(value);
  if (result.ok) {
    throw new Error("expected a validation error, got ok");
  }
  return result.error;
}

/** Clone-and-corrupt helper for the rejection matrix. */
function corrupt(mutate: (blob: Record<string, any>) => void): unknown {
  const wire = overWire(toSaveBlob(richState(), SAVED_AT)) as Record<string, any>;
  mutate(wire);
  return wire;
}

describe("toSaveBlob", () => {
  it("stamps the current schema version, the state's seed, and savedAt", () => {
    const state = richState();
    const blob = toSaveBlob(state, SAVED_AT);
    expect(blob.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(blob.seed).toBe(state.seed);
    expect(blob.savedAt).toBe(SAVED_AT);
    expect(blob.state).toBe(state); // shared, not cloned — GameState is immutable
  });
});

describe("fromSaveBlob round-trip (the Phase 2 gate)", () => {
  it("deep-equals after toSaveBlob → JSON → fromSaveBlob", () => {
    const state = richState();
    const blob = toSaveBlob(state, SAVED_AT);
    const restored = mustLoad(overWire(blob));
    expect(restored).toStrictEqual(blob);
    expect(restored.state).toStrictEqual(state);
  });

  it("preserves every rng stream cursor exactly (spec §2 rule 3)", () => {
    const state = richState();
    const restored = mustLoad(overWire(toSaveBlob(state, SAVED_AT)));
    expect(restored.state.rngState).toStrictEqual(state.rngState);
    // The save touched several streams at different cursor depths.
    expect(Object.keys(restored.state.rngState).sort()).toEqual(
      ["dialogue", "expedition-loot", "genesis", "quirks"],
    );
  });

  it("continues rng streams identically after save/load: 5 draws pre-save, next 5 match", () => {
    const seed = 987_654_321;
    const live = createRng(seed);
    const stream = live.stream("expedition-loot");
    for (let i = 0; i < 5; i++) stream.next(); // mid-play draws before the save

    const state: GameState = { ...richState(seed), rngState: live.getState() };
    const restoredSave = mustLoad(overWire(toSaveBlob(state, SAVED_AT)));
    const restoredRng = createRngFromState(
      restoredSave.state.seed,
      restoredSave.state.rngState,
    );

    const fromOriginal = Array.from({ length: 5 }, () => stream.next());
    const restoredStream = restoredRng.stream("expedition-loot");
    const fromRestored = Array.from({ length: 5 }, () => restoredStream.next());
    expect(fromRestored).toEqual(fromOriginal);
  });

  it("derives never-touched streams identically after restore", () => {
    const state = richState();
    const restoredSave = mustLoad(overWire(toSaveBlob(state, SAVED_AT)));
    const restoredRng = createRngFromState(
      restoredSave.state.seed,
      restoredSave.state.rngState,
    );
    const fresh = createRng(state.seed);
    expect(restoredRng.stream("egg-rolls").next()).toBe(
      fresh.stream("egg-rolls").next(),
    );
  });
});

describe("fromSaveBlob validation", () => {
  it("rejects non-objects with a typed not-an-object error", () => {
    for (const bad of [null, undefined, 42, "save", true, [1, 2, 3]]) {
      const error = mustFail(bad);
      expect(error.code).toBe("not-an-object");
      expect(error.path).toBe("");
    }
  });

  it("rejects a wrong schemaVersion (older saves must migrate first)", () => {
    const error = mustFail(corrupt((b) => { b["schemaVersion"] = CURRENT_SCHEMA_VERSION + 1; }));
    expect(error.code).toBe("unsupported-schema-version");
    expect(error.path).toBe("schemaVersion");
  });

  it("rejects a missing or non-numeric seed / savedAt", () => {
    expect(mustFail(corrupt((b) => { delete b["seed"]; })).path).toBe("seed");
    expect(mustFail(corrupt((b) => { b["savedAt"] = "yesterday"; })).path).toBe("savedAt");
    expect(mustFail(corrupt((b) => { b["savedAt"] = Number.NaN; })).path).toBe("savedAt");
  });

  it("rejects an envelope seed that disagrees with state.seed", () => {
    const error = mustFail(corrupt((b) => { b["seed"] = 1; }));
    expect(error.code).toBe("invalid-field");
    expect(error.path).toBe("seed");
  });

  it("rejects malformed state with a path pointing at the fault", () => {
    expect(mustFail(corrupt((b) => { b["state"] = null; })).path).toBe("state");
    expect(mustFail(corrupt((b) => { b["state"]["pips"] = []; })).path).toBe("state.pips");
    expect(
      mustFail(corrupt((b) => { delete b["state"]["pips"]["pip-1"]["needs"]["hunger"]; })).path,
    ).toBe("state.pips.pip-1.needs.hunger");
    expect(
      mustFail(corrupt((b) => { b["state"]["pips"]["pip-2"]["lifeStage"] = "elder"; })).path,
    ).toBe("state.pips.pip-2.lifeStage");
    expect(
      mustFail(corrupt((b) => { b["state"]["pips"]["pip-3"]["activity"] = "napping"; })).path,
    ).toBe("state.pips.pip-3.activity");
    expect(
      mustFail(corrupt((b) => { b["state"]["pips"]["pip-1"]["expedition"] = { expeditionId: "x", departedAt: 0 }; })).path,
    ).toBe("state.pips.pip-1.expedition.durationMs");
    expect(
      mustFail(corrupt((b) => { b["state"]["rngState"]["dialogue"] = "abc"; })).path,
    ).toBe("state.rngState.dialogue");
  });

  it("rejects a pip whose id disagrees with its record key", () => {
    const error = mustFail(corrupt((b) => { b["state"]["pips"]["pip-1"]["id"] = "pip-9"; }));
    expect(error.path).toBe("state.pips.pip-1.id");
  });

  it("rejects roster/active references to unknown pips", () => {
    expect(
      mustFail(corrupt((b) => { b["state"]["rosterOrder"].push("pip-99"); })).path,
    ).toBe("state.rosterOrder[3]");
    expect(
      mustFail(corrupt((b) => { b["state"]["activePipId"] = "pip-99"; })).path,
    ).toBe("state.activePipId");
  });

  it("rejects unknown cooldown actions and dialogue contexts", () => {
    expect(
      mustFail(corrupt((b) => { b["state"]["cooldowns"]["pip-1"]["tickle"] = 5; })).code,
    ).toBe("invalid-field");
    expect(
      mustFail(corrupt((b) => { b["state"]["lastLineIndex"]["pip-1"]["angry"] = 0; })).code,
    ).toBe("invalid-field");
  });

  it("rejects malformed eggs and dangling reveal references (v2 fields)", () => {
    expect(
      mustFail(corrupt((b) => { b["state"]["eggs"][0]["state"] = "boiled"; })).path,
    ).toBe("state.eggs[0].state");
    expect(
      mustFail(corrupt((b) => { b["state"]["eggs"][1]["incubationStartedAt"] = "soon"; })).path,
    ).toBe("state.eggs[1].incubationStartedAt");
    expect(
      mustFail(corrupt((b) => { b["state"]["pendingReveals"][0]["pipId"] = "pip-99"; })).path,
    ).toBe("state.pendingReveals[0].pipId");
    expect(
      mustFail(corrupt((b) => { b["state"]["pendingReveals"][0]["items"] = [1]; })).path,
    ).toBe("state.pendingReveals[0].items[0]");
    expect(
      mustFail(corrupt((b) => { delete b["state"]["keep"]; })).path,
    ).toBe("state.keep");
  });

  it("rejects malformed keep/jobs slices (v3 fields, deep)", () => {
    expect(
      mustFail(corrupt((b) => { b["state"]["keep"]["level"] = 2.5; })).path,
    ).toBe("state.keep.level");
    expect(
      mustFail(corrupt((b) => { b["state"]["keep"]["placements"]["place-1"]["x"] = "left"; })).path,
    ).toBe("state.keep.placements.place-1.x");
    expect(
      mustFail(corrupt((b) => { delete b["state"]["keep"]["placements"]["place-1"]["itemId"]; })).path,
    ).toBe("state.keep.placements.place-1.itemId");
    expect(
      mustFail(corrupt((b) => { b["state"]["jobs"]["pip-2"]["lastProducedAt"] = null; })).path,
    ).toBe("state.jobs.pip-2.lastProducedAt");
    // Referential integrity: the working pip and the station must exist.
    expect(
      mustFail(corrupt((b) => {
        b["state"]["jobs"]["pip-99"] = b["state"]["jobs"]["pip-2"];
        delete b["state"]["jobs"]["pip-2"];
      })).path,
    ).toBe("state.jobs.pip-99");
    expect(
      mustFail(corrupt((b) => {
        b["state"]["jobs"]["pip-2"]["stationPlacementId"] = "place-99";
      })).path,
    ).toBe("state.jobs.pip-2.stationPlacementId");
    expect(
      mustFail(corrupt((b) => { b["state"]["rosterUpgradePurchased"] = "yes"; })).path,
    ).toBe("state.rosterUpgradePurchased");
    expect(
      mustFail(corrupt((b) => { b["state"]["pips"]["pip-1"]["evolved"] = "verdant"; })).path,
    ).toBe("state.pips.pip-1.evolved");
  });

  it("rejects malformed onboarding (v4 field, deep — the sim reads it)", () => {
    expect(
      mustFail(corrupt((b) => { delete b["state"]["onboarding"]; })).path,
    ).toBe("state.onboarding");
    expect(
      mustFail(corrupt((b) => { b["state"]["onboarding"]["completed"] = "yes"; })).path,
    ).toBe("state.onboarding.completed");
    expect(
      mustFail(corrupt((b) => { b["state"]["onboarding"]["step"] = "dance"; })).path,
    ).toBe("state.onboarding.step");
  });

  it("rejects transients that are neither null nor an object", () => {
    expect(
      mustFail(corrupt((b) => { b["state"]["lastCareOutcome"] = 5; })).path,
    ).toBe("state.lastCareOutcome");
    expect(
      mustFail(corrupt((b) => { b["state"]["lastCatchup"] = "away"; })).path,
    ).toBe("state.lastCatchup");
  });

  it("never throws, whatever it is fed", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      0,
      Number.NaN,
      "{]",
      Symbol("save") as unknown,
      () => 0,
      [],
      {},
      { schemaVersion: 1 },
      { schemaVersion: 1, seed: 1, savedAt: 1, state: {} },
      { schemaVersion: 1, seed: 1, savedAt: 1, state: { pips: { a: 1 } } },
      new Date(),
      corrupt((b) => { b["state"]["inventory"]["berry"] = {}; }),
    ];
    for (const input of hostile) {
      expect(() => fromSaveBlob(input)).not.toThrow();
      expect(fromSaveBlob(input).ok).toBe(false);
    }
  });
});

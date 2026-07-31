/**
 * Egg lifecycle tests (spec §7, Phase 4 gate):
 *
 * - Incubation timers are DERIVED (incubationStartedAt + incubationMs) —
 *   flip to Pipping on TICK at exactly the boundary, never before.
 * - An egg completes FULLY during a long absence — even past the 12h
 *   offline rate cap ("timers are not capped", §4.5) — via the catch-up
 *   custom-event seam, and then WAITS in Pipping at load: hatching is
 *   player-witnessed, never automatic (spec §7.2 hard rule).
 * - HATCH_EGG at the roster cap refuses with the friendly typed message,
 *   leaves the egg intact (spec §7.4), and rolls nothing.
 * - Eggs never expire: a 30-day-old Pipping egg still hatches.
 * - Hatch rolls the genome from the "egg" stream (deterministic, cursor
 *   persisted) and creates a Pipling via the shared construction path.
 *
 * All time is explicit FakeClock-style timestamps — no ambient clocks.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { ROSTER_FULL_MESSAGE } from "../../content/eggs";
import { species as contentSpecies } from "../../content/species";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { createRngFromState } from "../rng";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipNeeds, PipState } from "../pips/types";
import { rollGenome } from "../pips/genome";
import { NAME_POOL } from "../../content/names";
import { ACCESSORY_ROLL_POOL } from "../../content/accessories";
import { runCatchup } from "../pips/catchup";
import type { GameState } from "../state";
import { createNewGame, rootReducer } from "../state";
import {
  EGG_READY_TAG,
  EGG_STREAM,
  EggState,
  beginIncubation,
  collectEggCatchupEvents,
  createEgg,
  eggReadyAt,
  resolveIncubationMs,
  settleDueEggs,
} from "./index";
import type { Egg } from "./index";

const T0 = 1_000_000;
const INCUBATION = tuning.eggs.incubationMsDefault;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 80, cleanliness: 80, happiness: 80, energy: 80, ...overrides };
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
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: T0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: T0,
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const pips = overrides.pips ?? { "pip-1": makePip("pip-1") };
  const rosterOrder = overrides.rosterOrder ?? Object.keys(pips);
  return {
    pips,
    rosterOrder,
    activePipId: rosterOrder[0] ?? "pip-1",
    inventory: {},
    resources: {},
    rngState: {},
    seed: 42,
    keep: { level: 3, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: Object.keys(pips).length + 1,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: 0,
    lastTickAt: T0,
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

function incubatingEgg(id: string, startedAt: number, incubationMs = INCUBATION): Egg {
  return {
    id,
    state: EggState.Incubating,
    foundAt: startedAt,
    rarity: "common",
    incubationMs,
    incubationStartedAt: startedAt,
    sourceExpeditionId: null,
  };
}

function pippingEgg(id: string, foundAt: number): Egg {
  return { ...incubatingEgg(id, foundAt), state: EggState.Pipping };
}

describe("egg primitives (spec §7.2)", () => {
  it("createEgg produces a Found egg with the tuning incubation for its rarity", () => {
    const egg = createEgg({ id: "egg-1", foundAt: T0, sourceExpeditionId: "meadow" });
    expect(egg.state).toBe(EggState.Found);
    expect(egg.rarity).toBe(tuning.eggs.expeditionEggRarity);
    expect(egg.incubationMs).toBe(INCUBATION);
    expect(egg.incubationStartedAt).toBeNull();
    expect(eggReadyAt(egg)).toBeNull(); // no timer until incubation starts
  });

  it("resolveIncubationMs prefers the per-rarity override, defaults otherwise (spec §7.2)", () => {
    const custom = {
      eggs: {
        incubationMsDefault: 2 * HOUR_MS,
        incubationMsByRarity: { rare: 6 * HOUR_MS },
        expeditionEggRarity: "common",
      },
    };
    expect(resolveIncubationMs("rare", custom)).toBe(6 * HOUR_MS);
    expect(resolveIncubationMs("common", custom)).toBe(2 * HOUR_MS);
    expect(resolveIncubationMs("unheard-of", custom)).toBe(2 * HOUR_MS);
  });

  it("beginIncubation starts the derived timer; it never restarts or regresses", () => {
    const egg = beginIncubation(
      createEgg({ id: "egg-1", foundAt: T0, sourceExpeditionId: null }),
      T0 + 500,
    );
    expect(egg.state).toBe(EggState.Incubating);
    expect(egg.incubationStartedAt).toBe(T0 + 500);
    expect(eggReadyAt(egg)).toBe(T0 + 500 + INCUBATION);
    // Idempotent past Found: a Pipping egg is left exactly as it is.
    const pipping = pippingEgg("egg-2", T0);
    expect(beginIncubation(pipping, T0 + 9_999)).toBe(pipping);
  });

  it("settleDueEggs flips exactly at the boundary (inclusive), never early, never hatches", () => {
    const eggs = [incubatingEgg("egg-1", T0)];
    const before = settleDueEggs(eggs, T0 + INCUBATION - 1);
    expect(before).toBe(eggs); // untouched (by reference) while not due
    const at = settleDueEggs(eggs, T0 + INCUBATION);
    expect(at[0]?.state).toBe(EggState.Pipping);
    // WAY past due: still only Pipping — hatching waits for the player.
    const wayPast = settleDueEggs(eggs, T0 + 500 * HOUR_MS);
    expect(wayPast[0]?.state).toBe(EggState.Pipping);
  });
});

describe("egg completion during catch-up (spec §4.5/§7.2)", () => {
  it("collectEggCatchupEvents yields one eggReady custom event per in-window completion", () => {
    const state = {
      pips: [makePip("pip-1")],
      eggs: [
        incubatingEgg("egg-in", T0), // completes T0 + 2h — in window
        incubatingEgg("egg-late", T0 + 100 * HOUR_MS), // completes far beyond
        pippingEgg("egg-done", T0), // no timer
      ],
    };
    const events = collectEggCatchupEvents(state, T0, T0 + 24 * HOUR_MS);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "custom",
      tag: EGG_READY_TAG,
      at: T0 + INCUBATION,
    });
  });

  it("an egg completes fully during a 3-day absence and WAITS in Pipping at load", () => {
    // Egg starts incubating 1 minute before the save; the player is gone
    // for 3 days. The completion (2h in) fires during catch-up; at load
    // the egg is Pipping — cracked, wobbling, waiting. NOT hatched.
    const savedAt = T0;
    const now = T0 + 72 * HOUR_MS;
    const state = makeState({
      eggs: [incubatingEgg("egg-1", savedAt - MINUTE_MS)],
    });
    const next = rootReducer(state, { type: "CATCHUP", savedAt, now });
    expect(next.eggs[0]?.state).toBe(EggState.Pipping);
    expect(next.pips["pip-1"]).toBeDefined(); // nothing hatched
    expect(next.rosterOrder).toEqual(state.rosterOrder);
    // The away sheet knows: the eggReady event fired at the exact moment.
    const eggEvents = (next.lastCatchup?.events ?? []).filter(
      (e) => e.kind === "custom" && e.tag === EGG_READY_TAG,
    );
    expect(eggEvents).toHaveLength(1);
    expect(eggEvents[0]?.at).toBe(savedAt - MINUTE_MS + INCUBATION);
  });

  it("incubation is NOT capped by the 12h offline rate cap (timers are never capped)", () => {
    // A slow egg (24h incubation) completes at savedAt + 24h — well past
    // the 12h rate cap. Rates freeze there; the timer must not.
    const savedAt = T0;
    const now = T0 + 72 * HOUR_MS;
    const slow = incubatingEgg("egg-slow", savedAt, 24 * HOUR_MS);
    expect(24 * HOUR_MS).toBeGreaterThan(tuning.offlineRateCapMs);
    const state = makeState({ eggs: [slow] });
    const next = rootReducer(state, { type: "CATCHUP", savedAt, now });
    expect(next.eggs[0]?.state).toBe(EggState.Pipping);
    const eggEvents = (next.lastCatchup?.events ?? []).filter(
      (e) => e.kind === "custom" && e.tag === EGG_READY_TAG,
    );
    expect(eggEvents[0]?.at).toBe(savedAt + 24 * HOUR_MS);
  });

  it("runCatchup's engine fires the seam without the reducer (unit-level)", () => {
    const state = {
      pips: [makePip("pip-1")],
      eggs: [incubatingEgg("egg-1", T0)],
    };
    const result = runCatchup(
      state,
      T0,
      T0 + 24 * HOUR_MS,
      tuning,
      collectEggCatchupEvents,
    );
    expect(result.state.eggs[0]?.state).toBe(EggState.Pipping);
  });

  it("an egg already due at the window start is healed to Pipping (not lost)", () => {
    // Defensive: the live loop should have flipped it before saving, but
    // a save written in the same ms can race — CATCHUP normalizes.
    const savedAt = T0;
    const state = makeState({
      eggs: [incubatingEgg("egg-1", savedAt - INCUBATION - HOUR_MS)],
    });
    const next = rootReducer(state, {
      type: "CATCHUP",
      savedAt,
      now: savedAt + MINUTE_MS,
    });
    expect(next.eggs[0]?.state).toBe(EggState.Pipping);
  });
});

describe("TICK incubation (spec §7.2)", () => {
  it("flips Incubating → Pipping at exactly the derived moment, and never auto-hatches", () => {
    const state = makeState({ eggs: [incubatingEgg("egg-1", T0)] });
    const early = rootReducer(state, { type: "TICK", at: T0 + INCUBATION - 1 });
    expect(early.eggs[0]?.state).toBe(EggState.Incubating);
    const due = rootReducer(early, { type: "TICK", at: T0 + INCUBATION });
    expect(due.eggs[0]?.state).toBe(EggState.Pipping);
    // Days later it is still Pipping — the tap is the only way forward.
    const later = rootReducer(due, { type: "TICK", at: T0 + 100 * HOUR_MS });
    expect(later.eggs[0]?.state).toBe(EggState.Pipping);
    expect(later.rosterOrder).toHaveLength(1);
  });
});

describe("DEBUG_SPAWN_EGG (spec §14 dev seam)", () => {
  it("drops an already-incubating egg with a deterministic id", () => {
    const state = makeState();
    const next = rootReducer(state, { type: "DEBUG_SPAWN_EGG", at: T0 });
    expect(next.eggs).toHaveLength(1);
    expect(next.eggs[0]).toMatchObject({
      id: "egg-1",
      state: EggState.Incubating,
      incubationStartedAt: T0,
      sourceExpeditionId: null,
    });
    expect(next.nextEggNumber).toBe(2);
    const again = rootReducer(next, { type: "DEBUG_SPAWN_EGG", at: T0 + 1 });
    expect(again.eggs[1]?.id).toBe("egg-2");
  });
});

describe("HATCH_EGG (spec §7.2/§7.4)", () => {
  it("hatches a Pipping egg into a Pipling rolled from the 'egg' stream", () => {
    const state = makeState({ eggs: [pippingEgg("egg-1", T0)] });
    const at = T0 + HOUR_MS;

    // Reference roll: same seed, same cursors, same stream — the reducer
    // must consume exactly this genome. `accessoryIds` mirrors core/state.ts's
    // HATCH_EGG call exactly (round 2D item 3) — the production reducer
    // hands rollGenome the real, weighted accessory pool, not the bare
    // default.
    const expectedGenome = rollGenome(
      createRngFromState(state.seed, state.rngState).stream(EGG_STREAM),
      { accessoryIds: ACCESSORY_ROLL_POOL },
    );

    const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-1", at });
    expect(next.rosterOrder).toEqual(["pip-1", "pip-2"]);
    const pipling = next.pips["pip-2"];
    expect(pipling).toBeDefined();
    expect(pipling?.genome).toEqual(expectedGenome);
    expect(pipling?.lifeStage).toBe(LifeStage.Pipling);
    expect(pipling?.activity).toBe(PipActivity.Idle);
    expect(pipling?.hatchedAt).toBe(at);
    // ROUND 2D: a hatchling gets an individually rolled name (docs/
    // BACKLOG.md "Round 2D" item 1), NOT its species name — the exact
    // flaw the round exists to fix ("every Pip is literally named after
    // its species").
    expect(NAME_POOL).toContain(pipling?.name);
    expect(pipling?.name).not.toBe(contentSpecies[expectedGenome.speciesId]?.name);
    expect(next.eggs).toEqual([]); // Hatched is terminal — egg removed
    expect(next.nextPipNumber).toBe(3);
    expect(next.lastHatchOutcome).toEqual({
      ok: true,
      eggId: "egg-1",
      pipId: "pip-2",
      at,
    });
    // The egg-stream cursor advanced and persisted (reload never re-rolls).
    expect(next.rngState[EGG_STREAM]).toBeTypeOf("number");
  });

  it("hatching is deterministic per save: same state, same Pipling", () => {
    const state = makeState({ eggs: [pippingEgg("egg-1", T0)] });
    const a = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-1", at: T0 });
    const b = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-1", at: T0 });
    expect(a.pips["pip-2"]).toEqual(b.pips["pip-2"]);
  });

  it("at the roster cap: friendly typed refusal, egg intact and still Pipping, no rolls", () => {
    const pips = {
      "pip-1": makePip("pip-1"),
      "pip-2": makePip("pip-2"),
      "pip-3": makePip("pip-3"),
    };
    expect(Object.keys(pips)).toHaveLength(tuning.rosterCap);
    const state = makeState({ pips, eggs: [pippingEgg("egg-1", T0)] });
    const next = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: T0 + 1,
    });
    expect(next.lastHatchOutcome).toEqual({
      ok: false,
      eggId: "egg-1",
      at: T0 + 1,
      reason: "rosterFull",
      message: ROSTER_FULL_MESSAGE,
    });
    // Friendly, not punishing (spec §15 tone bar): no exclamation of
    // blame, and the egg is exactly as it was.
    expect(next.eggs).toEqual(state.eggs);
    expect(next.rosterOrder).toEqual(state.rosterOrder);
    expect(next.rngState).toEqual(state.rngState); // zero rolls consumed
    expect(next.nextPipNumber).toBe(state.nextPipNumber);
  });

  it("eggs NEVER expire: a 30-day-old Pipping egg still hatches (spec §7.4)", () => {
    const state = makeState({ eggs: [pippingEgg("egg-1", T0)] });
    const monthLater = T0 + 30 * 24 * HOUR_MS;
    // A month of ticks and a catch-up pass leave the egg untouched...
    let aged = rootReducer(state, {
      type: "CATCHUP",
      savedAt: T0,
      now: monthLater,
    });
    aged = rootReducer(aged, { type: "TICK", at: monthLater + MINUTE_MS });
    expect(aged.eggs[0]?.state).toBe(EggState.Pipping);
    // ...and it hatches on the spot.
    const hatched = rootReducer(aged, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: monthLater + MINUTE_MS,
    });
    expect(hatched.lastHatchOutcome?.ok).toBe(true);
    expect(hatched.rosterOrder).toHaveLength(2);
  });

  it("refuses structurally on unknown or not-yet-Pipping eggs (no state change)", () => {
    const state = makeState({ eggs: [incubatingEgg("egg-1", T0)] });
    const unknown = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: "egg-9",
      at: T0,
    });
    expect(unknown.lastHatchOutcome).toMatchObject({ ok: false, reason: "unknownEgg" });
    const early = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: T0,
    });
    expect(early.lastHatchOutcome).toMatchObject({ ok: false, reason: "notPipping" });
    expect(early.eggs).toEqual(state.eggs);
    expect(early.rosterOrder).toEqual(state.rosterOrder);
  });

  it("hatched Piplings integrate with the roster cap: cap reached after hatching", () => {
    const state = makeState({
      pips: { "pip-1": makePip("pip-1"), "pip-2": makePip("pip-2") },
      eggs: [pippingEgg("egg-1", T0), pippingEgg("egg-2", T0)],
      nextPipNumber: 3,
    });
    const one = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-1", at: T0 });
    expect(one.lastHatchOutcome?.ok).toBe(true);
    expect(one.rosterOrder).toHaveLength(3);
    // Roster now full — the second egg politely waits.
    const two = rootReducer(one, { type: "HATCH_EGG", eggId: "egg-2", at: T0 });
    expect(two.lastHatchOutcome).toMatchObject({ ok: false, reason: "rosterFull" });
    expect(two.eggs).toHaveLength(1);
  });
});

describe("HATCH_EGG — biome-themed egg pools (round 2B, orchestrator ruling #1)", () => {
  /** Independent reference registry for a pool of species ids — built the
   * same way `eggSpeciesPoolFor` (core/state.ts) does, but from the test
   * side, so the assertion doesn't just call the implementation back. */
  function poolRegistry(
    ids: readonly string[],
  ): Record<string, (typeof contentSpecies)[string]> {
    const out: Record<string, (typeof contentSpecies)[string]> = {};
    for (const id of ids) {
      const entry = contentSpecies[id];
      if (entry !== undefined) out[id] = entry;
    }
    return out;
  }

  it("an egg found on an expedition with an eggSpecies pool only ever hatches from that pool", () => {
    const forestPool = contentExpeditions.forest.eggSpecies;
    expect(forestPool).toBeDefined();
    const state = makeState({
      eggs: [{ ...pippingEgg("egg-1", T0), sourceExpeditionId: "forest" }],
    });
    const at = T0 + HOUR_MS;

    const expectedGenome = rollGenome(
      createRngFromState(state.seed, state.rngState).stream(EGG_STREAM),
      { species: poolRegistry(forestPool ?? []), accessoryIds: ACCESSORY_ROLL_POOL },
    );

    const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-1", at });
    const pipling = next.pips["pip-2"];
    expect(pipling?.genome).toEqual(expectedGenome);
    expect(forestPool).toContain(pipling?.genome.speciesId);
  });

  it("a different biome's egg draws only from ITS pool (Shore never hatches a Forest-only species)", () => {
    const shorePool = contentExpeditions.shore.eggSpecies ?? [];
    const state = makeState({
      eggs: [{ ...pippingEgg("egg-1", T0), sourceExpeditionId: "shore" }],
    });
    const next = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: T0 + HOUR_MS,
    });
    expect(shorePool).toContain(next.pips["pip-2"]?.genome.speciesId);
    expect(next.pips["pip-2"]?.genome.speciesId).not.toBe("pebblepip"); // Forest/Bramblewick-only
  });

  it("an egg with no sourceExpeditionId (the DEBUG_SPAWN_EGG QA seam, spec §14) still rolls the whole registry", () => {
    const state = makeState({ eggs: [pippingEgg("egg-1", T0)] }); // sourceExpeditionId: null
    const expectedGenome = rollGenome(
      createRngFromState(state.seed, state.rngState).stream(EGG_STREAM),
      { accessoryIds: ACCESSORY_ROLL_POOL },
    );
    const next = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: T0 + HOUR_MS,
    });
    expect(next.pips["pip-2"]?.genome).toEqual(expectedGenome);
  });

  it("falls back to the whole registry when sourceExpeditionId doesn't resolve to a known expedition (defensive)", () => {
    const state = makeState({
      eggs: [{ ...pippingEgg("egg-1", T0), sourceExpeditionId: "nonexistent-biome" }],
    });
    const expectedGenome = rollGenome(
      createRngFromState(state.seed, state.rngState).stream(EGG_STREAM),
      { accessoryIds: ACCESSORY_ROLL_POOL },
    );
    const next = rootReducer(state, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: T0 + HOUR_MS,
    });
    expect(next.pips["pip-2"]?.genome).toEqual(expectedGenome);
  });

  it("RNG CURSOR PARITY (hard constraint, orchestrator ruling #1): the egg stream advances IDENTICALLY no matter which biome pool an egg rolls from", () => {
    // Forest's pool has 3 species, Shore's has 2, and the no-pool default
    // rolls across the whole registry (14) — three very different sizes.
    const at = T0 + HOUR_MS;
    const cursorAfter = (sourceExpeditionId: string | null): unknown => {
      const state = makeState({
        eggs: [{ ...pippingEgg("egg-1", T0), sourceExpeditionId }],
      });
      const next = rootReducer(state, { type: "HATCH_EGG", eggId: "egg-1", at });
      return next.rngState[EGG_STREAM];
    };
    const forestCursor = cursorAfter("forest");
    const shoreCursor = cursorAfter("shore");
    const wholeRegistryCursor = cursorAfter(null);
    expect(forestCursor).toBeTypeOf("number");
    expect(shoreCursor).toBe(forestCursor);
    expect(wholeRegistryCursor).toBe(forestCursor);
  });
});

describe("createNewGame integration", () => {
  it("new saves start with no eggs, no reveals, level-1 Keep, and counters at their base", () => {
    const state = createNewGame(7, 0);
    expect(state.eggs).toEqual([]);
    expect(state.pendingReveals).toEqual([]);
    expect(state.keep).toEqual({ level: 1, placements: {} });
    expect(state.nextPipNumber).toBe(2);
    expect(state.nextEggNumber).toBe(1);
  });
});

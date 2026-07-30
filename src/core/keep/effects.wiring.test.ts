/**
 * WIRED-UP tests (docs/progression-bible.md §3.2, orchestrator ruling #2):
 * `resolveKeepEffects` existing is not the same claim as it APPLYING.
 * Every assertion in this file drives the change through the thing a
 * player actually touches — `rootReducer` dispatching TICK/CATCHUP/
 * ASSIGN_EXPEDITION — with REAL content from `content/placeables.ts`.
 *
 * ALL SIX CHANNELS GO THROUGH THE REDUCER. This file used to cover comfort
 * (Food Bowl) and restSpeed (Bed) through `rootReducer` while testing
 * expeditionSpeed, incubationSpeed, expeditionLoot and eggChancePoints by
 * calling `assignExpedition`/`createEgg` DIRECTLY with a hand-supplied
 * multiplier — excused by a header claiming "no shipped item yet carries
 * an effect kind (expedition duration/loot, egg incubation — those await
 * the content round's Trail Post/Beacon/Nest Warmer)". That premise was
 * false in the very tree it shipped in: `content/placeables.ts` carries
 * `beacon` (expeditionSpeed 0.92), `nest-warmer` (incubationSpeed 0.85),
 * `trail-post` (expeditionLoot +0.03) and `weathervane` (eggChancePoints
 * +0.01), and none of those four ids appeared in any test.
 *
 * The cost of the gap was measured, not theorised: replacing
 * `keepSpeedMultiplier: keepEffects.expeditionSpeedMultiplier` with a bare
 * `1` at the ASSIGN_EXPEDITION seam, and `keepIncubationSpeedMultiplier`
 * with `1` at both egg seams, left the whole suite green — so a placed
 * Beacon and Nest Warmer could go on printing their promise on the Build
 * card and in the "How the Keep helps" readout while doing nothing at all
 * to trip length or hatch time. That is spec §16 v1.3's standing rule
 * inverted: visible in the UI, absent from the simulation.
 *
 * The two probabilistic channels (loot, egg chance) are proven the only
 * honest way for a channel whose whole job is to shift odds: a SEEDED
 * SWEEP through the reducer, comparing totals across identical seeds with
 * and without the building. Both stay deterministic — same seeds, same
 * rolls, same answer on every run.
 */

import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, tuning } from "../../content/tuning";
import { createNewGame, rootReducer } from "../state";
import type { GameState } from "../state";
import { PipActivity } from "../pips/types";
import { assignExpedition, settleExpeditionReturn } from "../expeditions";
import type { ExpeditionView } from "../expeditions";
import { createEgg } from "../eggs";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { resolveKeepEffects } from "./effects";

const SAVED_AT = 1_000 * HOUR_MS;

/** A one-Pip Keep with a chosen personality and every need pinned at
 * `start` — the same fixture shape `core/pips/balance.test.ts` uses, so
 * this file measures the same real reducer/content everything else does. */
function keepWith(
  personalityId: string,
  start = 90,
  placements: GameState["keep"]["placements"] = {},
): GameState {
  const base = createNewGame(7, SAVED_AT);
  const id = base.activePipId;
  const pip = base.pips[id];
  if (pip === undefined) throw new Error("createNewGame produced no starter");
  return {
    ...base,
    keep: { ...base.keep, placements },
    pips: {
      [id]: {
        ...pip,
        personalityId,
        genome: { ...pip.genome, personalityId },
        needs: { hunger: start, cleanliness: start, happiness: start, energy: start },
      },
    },
  };
}

describe("comfort actually slows decay THROUGH the real reducer (Food Bowl, bible §3.4)", () => {
  it("a Food Bowl measurably slows Hunger decay over a live TICK", () => {
    const hours = 10;
    const at = SAVED_AT + hours * HOUR_MS;

    const unbuilt = keepWith("lazy", 90);
    const built = keepWith("lazy", 90, { "place-1": { itemId: "food-bowl", x: 0, y: 0 } });

    const afterUnbuilt = rootReducer(unbuilt, { type: "TICK", at });
    const afterBuilt = rootReducer(built, { type: "TICK", at });

    const id = unbuilt.activePipId;
    const hungerUnbuilt = afterUnbuilt.pips[id]!.needs.hunger;
    const hungerBuilt = afterBuilt.pips[id]!.needs.hunger;

    expect(hungerBuilt).toBeGreaterThan(hungerUnbuilt);

    // Exact arithmetic: the Bowl's comfort is a FRACTION of the drop, not a
    // flat number — assert the actual formula, not just "some" difference.
    const personalityMult = tuning.personalityDecayMultipliers.lazy.hunger;
    const baseDrop = -tuning.needDecayPerHour.hunger * personalityMult * hours;
    const expectedUnbuilt = 90 - baseDrop;
    const expectedBuilt = 90 - baseDrop * (1 - 0.06);
    expect(hungerUnbuilt).toBeCloseTo(expectedUnbuilt, 6);
    expect(hungerBuilt).toBeCloseTo(expectedBuilt, 6);
  });

  it("does NOT touch other needs — the Bowl's comfort is Hunger-only", () => {
    const hours = 10;
    const at = SAVED_AT + hours * HOUR_MS;
    const built = keepWith("lazy", 90, { "place-1": { itemId: "food-bowl", x: 0, y: 0 } });
    const unbuilt = keepWith("lazy", 90);

    const afterBuilt = rootReducer(built, { type: "TICK", at });
    const afterUnbuilt = rootReducer(unbuilt, { type: "TICK", at });
    const id = built.activePipId;

    expect(afterBuilt.pips[id]!.needs.cleanliness).toBeCloseTo(
      afterUnbuilt.pips[id]!.needs.cleanliness,
      10,
    );
    expect(afterBuilt.pips[id]!.needs.energy).toBeCloseTo(
      afterUnbuilt.pips[id]!.needs.energy,
      10,
    );
  });

  it("the SAME comfort applies during an offline CATCHUP absence, not just a live TICK", () => {
    const hours = 20; // inside the 16h cap only partially — exercises the cap correctly either way
    const now = SAVED_AT + hours * HOUR_MS;
    const built = keepWith("lazy", 90, { "place-1": { itemId: "food-bowl", x: 0, y: 0 } });
    const unbuilt = keepWith("lazy", 90);

    const afterBuilt = rootReducer(built, { type: "CATCHUP", savedAt: SAVED_AT, now });
    const afterUnbuilt = rootReducer(unbuilt, { type: "CATCHUP", savedAt: SAVED_AT, now });
    const id = built.activePipId;

    expect(afterBuilt.pips[id]!.needs.hunger).toBeGreaterThan(
      afterUnbuilt.pips[id]!.needs.hunger,
    );
  });
});

describe("rest speed actually speeds naps THROUGH the real reducer (Bed, bible §3.4)", () => {
  it("a Bed finishes a nap sooner than an unbuilt Keep, watched through TICK", () => {
    const built = keepWith("lazy", 20, { "place-1": { itemId: "bed", x: 0, y: 0 } });
    const unbuilt = keepWith("lazy", 20);
    const id = built.activePipId;

    // Put both pips down to Rest at Energy 20 (bypassing the REST_TOGGLE
    // cooldown machinery — this fixture is ABOUT the rate, not the tap).
    const restingBuilt: GameState = {
      ...built,
      pips: { ...built.pips, [id]: { ...built.pips[id]!, activity: PipActivity.Resting } },
    };
    const restingUnbuilt: GameState = {
      ...unbuilt,
      pips: { ...unbuilt.pips, [id]: { ...unbuilt.pips[id]!, activity: PipActivity.Resting } },
    };

    // A window long enough for the UNBUILT bed-less nap to finish, so any
    // gap we see is purely the built Keep hitting the ceiling FIRST and
    // then holding at 100 while the unbuilt one is still catching up
    // partway through — proven below by shortening the window instead.
    const shortWindowMs = (40 / tuning.care.rest.energyPerHour) * HOUR_MS; // enough for the BUILT bed (×1.25) to add ~50, not enough for the unbuilt one to finish either — so compare directly
    const at = SAVED_AT + shortWindowMs;

    const afterBuilt = rootReducer(restingBuilt, { type: "TICK", at });
    const afterUnbuilt = rootReducer(restingUnbuilt, { type: "TICK", at });

    expect(afterBuilt.pips[id]!.needs.energy).toBeGreaterThan(
      afterUnbuilt.pips[id]!.needs.energy,
    );
  });

  it("the SAME rest speed applies during offline CATCHUP (exercises the wake-candidate prediction, not just applyNeedsDelta)", () => {
    const built = keepWith("lazy", 20, { "place-1": { itemId: "bed", x: 0, y: 0 } });
    const unbuilt = keepWith("lazy", 20);
    const id = built.activePipId;

    const restingBuilt: GameState = {
      ...built,
      pips: { ...built.pips, [id]: { ...built.pips[id]!, activity: PipActivity.Resting } },
    };
    const restingUnbuilt: GameState = {
      ...unbuilt,
      pips: { ...unbuilt.pips, [id]: { ...unbuilt.pips[id]!, activity: PipActivity.Resting } },
    };

    // A window inside which the BUILT (×1.25) Bed fully wakes but the
    // unbuilt Keep, at the base rate, has not yet — this is the case that
    // most needs the wake-candidate prediction to consult the multiplier
    // (a stale prediction would either freeze the built pip's Energy short
    // of 100, or wake it at the WRONG, too-late moment).
    const deficit = 80; // 20 -> 100
    const unbuiltWakeMs = (deficit / tuning.care.rest.energyPerHour) * HOUR_MS;
    const builtWakeMs = unbuiltWakeMs / 1.25;
    const midpointMs = (builtWakeMs + unbuiltWakeMs) / 2;
    const now = SAVED_AT + midpointMs;

    const afterBuilt = rootReducer(restingBuilt, { type: "CATCHUP", savedAt: SAVED_AT, now });
    const afterUnbuilt = rootReducer(restingUnbuilt, {
      type: "CATCHUP",
      savedAt: SAVED_AT,
      now,
    });

    // The built Pip has already auto-woken (Idle, Energy at/near 100 — it
    // ticks back down a hair afterward at the normal AWAKE decay rate,
    // which is correct: waking does not freeze Energy, it just stops the
    // nap); the unbuilt one has not (still Resting, Energy short of 100).
    expect(afterBuilt.pips[id]!.activity).toBe(PipActivity.Idle);
    expect(afterBuilt.pips[id]!.needs.energy).toBeGreaterThan(99);
    expect(afterUnbuilt.pips[id]!.activity).toBe(PipActivity.Resting);
    expect(afterUnbuilt.pips[id]!.needs.energy).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// THE FOUR CHANNELS THAT USED TO BE TESTED AT THE SEAM, NOW THROUGH THE REDUCER
// ---------------------------------------------------------------------------

/** A Keep at tier 12 (so nothing is level-gated) with `placements` injected
 * directly — PLACE_ITEM's own unlock/afford rules are another file's subject,
 * and this one is about whether a PLACED thing changes the simulation. */
function builtKeep(seed: number, placements: GameState["keep"]["placements"]): GameState {
  const base = createNewGame(seed, SAVED_AT);
  return { ...base, keep: { ...base.keep, level: 12, placements } };
}

/** N copies of one item, spread across distinct tiles. Effects SUM per
 * placement (`core/keep/effects.ts`'s accumulator), so this is also how a
 * 1-3% channel is driven up to its own cap where the odds shift becomes
 * measurable rather than a rounding error. */
function copies(itemId: string, n: number): GameState["keep"]["placements"] {
  const out: Record<string, { itemId: string; x: number; y: number }> = {};
  for (let i = 0; i < n; i++) out[`place-${i + 1}`] = { itemId, x: i, y: 0 };
  return out;
}

/** Dispatch a real ASSIGN_EXPEDITION and report the duration the reducer
 * actually baked into the trip. */
function assignedDurationMs(state: GameState, expeditionId: string): number {
  const id = state.activePipId;
  const after = rootReducer(state, {
    type: "ASSIGN_EXPEDITION",
    pipId: id,
    expeditionId,
    at: SAVED_AT,
  });
  const outcome = after.lastAssignOutcome;
  if (outcome === null || !outcome.ok) throw new Error("assign refused");
  expect(after.pips[id]!.expedition?.durationMs).toBe(outcome.durationMs);
  return outcome.durationMs;
}

/** Send one trip and TICK past its return, then report what came home. */
function runOneTrip(
  state: GameState,
  expeditionId: string,
): { readonly lootCount: number; readonly incubationMs: number | null } {
  const id = state.activePipId;
  const assigned = rootReducer(state, {
    type: "ASSIGN_EXPEDITION",
    pipId: id,
    expeditionId,
    at: SAVED_AT,
  });
  const durationMs = assigned.pips[id]!.expedition?.durationMs ?? 0;
  const returned = rootReducer(assigned, { type: "TICK", at: SAVED_AT + durationMs + 1 });
  const reveal = returned.pendingReveals[0];
  return {
    lootCount: reveal?.items.length ?? 0,
    incubationMs: reveal?.egg?.incubationMs ?? null,
  };
}

describe("expeditionSpeed reaches the trip THROUGH the real reducer (Beacon, bible §3.4)", () => {
  it("a placed Beacon shortens ASSIGN_EXPEDITION's baked durationMs on the Meadow", () => {
    const unbuilt = assignedDurationMs(builtKeep(7, {}), "meadow");
    const built = assignedDurationMs(
      builtKeep(7, { "place-1": { itemId: "beacon", x: 0, y: 0 } }),
      "meadow",
    );
    expect(built).toBeLessThan(unbuilt);
    // The Beacon is expeditionSpeed 0.92 — assert the actual arithmetic, not
    // merely "shorter", so a wrong multiplier is a failure too.
    expect(built).toBe(Math.round(unbuilt * 0.92));
  });

  it("shortens EVERY biome, not just the one the fixture happened to pick", () => {
    for (const expeditionId of ["meadow", "forest", "shore", "bramblewick"]) {
      const unbuilt = assignedDurationMs(builtKeep(11, {}), expeditionId);
      const built = assignedDurationMs(
        builtKeep(11, { "place-1": { itemId: "beacon", x: 0, y: 0 } }),
        expeditionId,
      );
      expect(built, expeditionId).toBeLessThan(unbuilt);
    }
  });

  it("two Beacons stack multiplicatively and then CLAMP at expeditionSpeedMin", () => {
    const unbuilt = assignedDurationMs(builtKeep(7, {}), "shore");
    const two = assignedDurationMs(builtKeep(7, copies("beacon", 2)), "shore");
    const eight = assignedDurationMs(builtKeep(7, copies("beacon", 8)), "shore");
    // 0.92 × 0.92 = 0.8464, clamped to the floor (0.85).
    const floor = tuning.progression.effectCaps.expeditionSpeedMin;
    expect(two).toBe(Math.round(unbuilt * floor));
    // Eight of them cannot go below the same floor — the clamp happens once.
    expect(eight).toBe(two);
  });

  it("an unbuilt Keep is byte-identical to the biome's own duration — no drift for a fresh save", () => {
    const state = builtKeep(7, {});
    expect(assignedDurationMs(state, "meadow")).toBe(contentExpeditions.meadow.durationMs);
  });

  it("the composed building + Hardworking floor holds — a building cannot out-do a personality identity", () => {
    // `effectCaps.expeditionSpeedFloorWithQuirk` (0.75) clamps
    // `personalityMultiplier × keepSpeedMultiplier`, i.e. "the best possible
    // trip is −25%". Nothing exercised it: no test put a Hardworking Pip on a
    // Beacon-built Keep, so the cap that keeps the quirk meaningful was unasserted.
    const floor = tuning.progression.effectCaps.expeditionSpeedFloorWithQuirk;
    const hardworking = (placements: GameState["keep"]["placements"]): GameState => {
      const base = builtKeep(7, placements);
      const id = base.activePipId;
      const pip = base.pips[id]!;
      return {
        ...base,
        pips: {
          [id]: {
            ...pip,
            personalityId: "hardworking",
            genome: { ...pip.genome, personalityId: "hardworking" },
          },
        },
      };
    };
    const nominal = contentExpeditions.shore.durationMs;
    const quirkOnly = assignedDurationMs(hardworking({}), "shore");
    const quirkPlusBeacons = assignedDurationMs(hardworking(copies("beacon", 8)), "shore");

    // The quirk alone is already faster than nominal…
    expect(quirkOnly).toBeLessThan(nominal);
    // …stacking eight Beacons on top is faster still…
    expect(quirkPlusBeacons).toBeLessThan(quirkOnly);
    // …but never past the composed floor.
    expect(quirkPlusBeacons).toBe(Math.round(nominal * floor));
    expect(quirkPlusBeacons / nominal).toBeGreaterThanOrEqual(floor - 1e-9);
  });
});

describe("incubationSpeed reaches a real egg THROUGH the real reducer (Nest Warmer, bible §3.4)", () => {
  /** The Nest Warmer changes only the SNAPSHOT of an egg's duration, never
   * the egg roll itself, so the same seed finds (or does not find) the same
   * egg either way — which is exactly what makes a paired comparison valid.
   * Scan for a seed whose Meadow trip comes home with one. */
  function seedThatFindsAnEgg(): number {
    for (let seed = 1; seed < 400; seed++) {
      if (runOneTrip(builtKeep(seed, {}), "meadow").incubationMs !== null) return seed;
    }
    throw new Error("no seed under 400 found an egg on the Meadow");
  }

  it("an egg found by a trip incubates faster with a Nest Warmer placed", () => {
    const seed = seedThatFindsAnEgg();
    const unbuilt = runOneTrip(builtKeep(seed, {}), "meadow").incubationMs;
    const built = runOneTrip(
      builtKeep(seed, { "place-1": { itemId: "nest-warmer", x: 0, y: 0 } }),
      "meadow",
    ).incubationMs;
    expect(unbuilt).not.toBeNull();
    expect(built).not.toBeNull();
    expect(built as number).toBeLessThan(unbuilt as number);
    // The Nest Warmer is incubationSpeed 0.85 — pin the arithmetic.
    expect(built as number).toBeCloseTo((unbuilt as number) * 0.85, 6);
  });

  it("the SAME multiplier applies to an egg an OFFLINE CATCHUP brings home", () => {
    const seed = seedThatFindsAnEgg();
    const send = (placements: GameState["keep"]["placements"]): number | null => {
      const state = builtKeep(seed, placements);
      const id = state.activePipId;
      const assigned = rootReducer(state, {
        type: "ASSIGN_EXPEDITION",
        pipId: id,
        expeditionId: "meadow",
        at: SAVED_AT,
      });
      const durationMs = assigned.pips[id]!.expedition?.durationMs ?? 0;
      const returned = rootReducer(assigned, {
        type: "CATCHUP",
        savedAt: SAVED_AT,
        now: SAVED_AT + durationMs + HOUR_MS,
      });
      return returned.pendingReveals[0]?.egg?.incubationMs ?? null;
    };
    const unbuilt = send({});
    const built = send({ "place-1": { itemId: "nest-warmer", x: 0, y: 0 } });
    expect(unbuilt).not.toBeNull();
    expect(built).not.toBeNull();
    expect(built as number).toBeLessThan(unbuilt as number);
  });

  it("stacked Nest Warmers clamp at incubationSpeedMin — the floor holds through the reducer", () => {
    const seed = seedThatFindsAnEgg();
    const unbuilt = runOneTrip(builtKeep(seed, {}), "meadow").incubationMs as number;
    const many = runOneTrip(builtKeep(seed, copies("nest-warmer", 9)), "meadow")
      .incubationMs as number;
    const floor = tuning.progression.effectCaps.incubationSpeedMin;
    expect(many).toBeCloseTo(unbuilt * floor, 6);
  });
});

describe("the DEBUG_SPAWN_EGG seam honours incubationSpeed too", () => {
  /**
   * Both PLAYER paths (TICK and CATCHUP) passed the Keep's multiplier and this
   * one did not, so a debug-spawned egg on a Nest-Warmer-built Keep snapshotted
   * the unbuilt duration and the effect looked DEAD to whoever was hand-checking
   * it — and the debug menu is exactly how this effect would be hand-checked
   * (spec §14). A QA seam that lies about a shipped effect is worse than no seam.
   */
  it("a debug-spawned egg incubates faster with a Nest Warmer placed", () => {
    const spawn = (placements: GameState["keep"]["placements"]): number => {
      const state = builtKeep(7, placements);
      const after = rootReducer(state, { type: "DEBUG_SPAWN_EGG", at: SAVED_AT });
      const egg = after.eggs[0];
      if (egg === undefined) throw new Error("debug spawn produced no egg");
      return egg.incubationMs;
    };
    const unbuilt = spawn({});
    const built = spawn({ "place-1": { itemId: "nest-warmer", x: 0, y: 0 } });
    expect(unbuilt).toBe(tuning.eggs.incubationMsDefault);
    expect(built).toBeLessThan(unbuilt);
    expect(built).toBeCloseTo(unbuilt * 0.85, 6);
  });

  it("an unbuilt Keep's debug egg is byte-identical to the content default", () => {
    const after = rootReducer(builtKeep(7, {}), { type: "DEBUG_SPAWN_EGG", at: SAVED_AT });
    expect(after.eggs[0]?.incubationMs).toBe(tuning.eggs.incubationMsDefault);
  });
});

describe("expeditionLoot reaches the haul THROUGH the real reducer (Trail Post, bible §3.4)", () => {
  /** Total loot across `seeds` identical trips. Deterministic: fixed seeds. */
  function totalLoot(placements: GameState["keep"]["placements"], seeds: number): number {
    let total = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      total += runOneTrip(builtKeep(seed, placements), "meadow").lootCount;
    }
    return total;
  }

  it("Trail Posts bring MORE home across a seeded sweep of identical trips", () => {
    const SEEDS = 160;
    const unbuilt = totalLoot({}, SEEDS);
    // Driven to the channel's own cap (`retention.loot.bonusRollChanceMax`,
    // 0.25) so the shift is far outside sampling noise — which also proves the
    // per-placement summation the accumulator does.
    const built = totalLoot(copies("trail-post", 9), SEEDS);
    expect(built).toBeGreaterThan(unbuilt);
  });

  it("one Trail Post is already a real, non-zero contribution to the composed chance", () => {
    // A single +0.03 is small by design, so assert it at the aggregation the
    // reducer feeds rather than by sampling: the channel is non-zero and the
    // reducer's own ASSIGN/TICK path is what carries it (proven above).
    const built = builtKeep(7, { "place-1": { itemId: "trail-post", x: 0, y: 0 } });
    expect(resolveKeepEffects(built.keep, built.keep.level).expeditionLootBonusChance)
      .toBeGreaterThan(0);
    expect(resolveKeepEffects(builtKeep(7, {}).keep, 12).expeditionLootBonusChance).toBe(0);
  });
});

describe("eggChancePoints reaches the egg roll THROUGH the real reducer (Weathervane, bible §3.4)", () => {
  function eggsFound(placements: GameState["keep"]["placements"], seeds: number): number {
    let found = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      if (runOneTrip(builtKeep(seed, placements), "meadow").incubationMs !== null) found++;
    }
    return found;
  }

  it("Weathervanes find MORE eggs across a seeded sweep of identical trips", () => {
    const SEEDS = 240;
    const unbuilt = eggsFound({}, SEEDS);
    // Driven to `retention.loot.eggChanceBonusPointsMax` (0.05) — the Meadow's
    // base chance is 0.08, so this is a ~60% relative lift and comfortably
    // outside noise at this sample size.
    const built = eggsFound(copies("weathervane", 7), SEEDS);
    expect(unbuilt).toBeGreaterThan(0); // sanity: the sweep does find eggs
    expect(built).toBeGreaterThan(unbuilt);
  });
});

describe("expedition duration/loot wiring — the pure seam beneath the reducer", () => {
  const meadow: ExpeditionView = {
    id: "meadow",
    unlockKeepLevel: 1,
    durationMs: 5 * MINUTE_MS,
    lootTable: [{ itemId: "berry", weight: 1 }],
    lootRolls: 3,
    eggChance: 0.08,
  };

  it("assignExpedition shortens the trip when content.keepSpeedMultiplier is supplied", () => {
    const state = keepWith("lazy", 90);
    const id = state.activePipId;

    const withoutBuilding = assignExpedition(state, id, "meadow", SAVED_AT, {
      registry: { meadow },
    });
    const withBuilding = assignExpedition(state, id, "meadow", SAVED_AT, {
      registry: { meadow },
      keepSpeedMultiplier: 0.9,
    });

    expect(withoutBuilding.outcome.ok).toBe(true);
    expect(withBuilding.outcome.ok).toBe(true);
    if (withoutBuilding.outcome.ok && withBuilding.outcome.ok) {
      expect(withBuilding.outcome.durationMs).toBeLessThan(withoutBuilding.outcome.durationMs);
    }
  });

  it("omitting keepSpeedMultiplier is byte-identical to the pre-2F formula (identity default)", () => {
    const state = keepWith("curious", 90);
    const id = state.activePipId;
    const withDefault = assignExpedition(state, id, "meadow", SAVED_AT, { registry: { meadow } });
    const withExplicit1 = assignExpedition(state, id, "meadow", SAVED_AT, {
      registry: { meadow },
      keepSpeedMultiplier: 1,
    });
    expect(withDefault.outcome).toEqual(withExplicit1.outcome);
  });

  it("keepIncubationSpeedMultiplier reaches createEgg through settleExpeditionReturn's content seam", () => {
    // A high-eggChance registry entry with a fixed seed still depends on
    // the roll; assert on the SHAPE of the plumbing instead — that when an
    // egg IS found, its incubationMs reflects the supplied multiplier —
    // by forcing eggChance to 1 so the roll is deterministic.
    const certainEgg: ExpeditionView = { ...meadow, eggChance: 1 };
    const state = keepWith("curious", 90);
    const withMultiplier = settleExpeditionReturn(
      state,
      state.activePipId,
      { expeditionId: "meadow", departedAt: SAVED_AT, durationMs: meadow.durationMs },
      SAVED_AT + meadow.durationMs,
      { registry: { meadow: certainEgg }, keepIncubationSpeedMultiplier: 0.85 },
    );
    const withoutMultiplier = settleExpeditionReturn(
      state,
      state.activePipId,
      { expeditionId: "meadow", departedAt: SAVED_AT, durationMs: meadow.durationMs },
      SAVED_AT + meadow.durationMs,
      { registry: { meadow: certainEgg } },
    );
    const eggWith = withMultiplier.pendingReveals[0]?.egg;
    const eggWithout = withoutMultiplier.pendingReveals[0]?.egg;
    expect(eggWith).not.toBeNull();
    expect(eggWithout).not.toBeNull();
    if (eggWith !== null && eggWith !== undefined && eggWithout !== null && eggWithout !== undefined) {
      expect(eggWith.incubationMs).toBeCloseTo(eggWithout.incubationMs * 0.85, 6);
    }
  });
});

describe("createEgg's incubationSpeedMultiplier (core/eggs/index.ts)", () => {
  it("defaults to 1 (no change to the rarity-based base duration)", () => {
    const egg = createEgg({ id: "egg-1", foundAt: SAVED_AT, sourceExpeditionId: null });
    expect(egg.incubationMs).toBe(tuning.eggs.incubationMsDefault);
  });

  it("scales the snapshotted incubationMs when supplied", () => {
    const egg = createEgg(
      { id: "egg-1", foundAt: SAVED_AT, sourceExpeditionId: null },
      tuning,
      0.85,
    );
    expect(egg.incubationMs).toBeCloseTo(tuning.eggs.incubationMsDefault * 0.85, 6);
  });
});

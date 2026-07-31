/**
 * BREEDING + LINEAGE EGGS — the pure calculator (spec §12 unfenced, spec
 * §16 v1.5, docs/lifecycle-bible.md §5–§6): shared inheritance, lineage
 * finds, and breeding eligibility/combination. End-to-end reducer wiring
 * (BREED_PIPS, HATCH_EGG's lineage/bred branch) is
 * `core/state.breeding.test.ts`'s job; the expedition settle-point find
 * roll is `core/expeditions/lineage.test.ts`'s. This file tests
 * `breeding.ts` in isolation, the same division of labour
 * `ailment.test.ts` vs `state.ailments.test.ts` already uses.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { HOUR_MS } from "../../content/tuning";
import { LifeStage, PipActivity } from "./types";
import type { PipState } from "./types";
import type { LineageEggSeed } from "./ailment";
import {
  LINEAGE_STREAM,
  attemptLineageFind,
  breedEligibility,
  combineForBreeding,
  lineageFindChance,
  oldestUnfoundSeedFor,
} from "./breeding";
import type { LineageTuning } from "./breeding";

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
      accessorySlots: 1,
      personalityId,
      shiny: false,
    },
    personalityId,
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: { hunger: 90, cleanliness: 90, happiness: 90, energy: 90 },
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    level: 8,
    ...overrides,
  };
}

function makeSeed(overrides: Partial<LineageEggSeed> = {}): LineageEggSeed {
  return {
    pipId: "pip-lost",
    name: "Mossy",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      accessorySlots: 1,
      personalityId: "curious",
      shiny: false,
    },
    expeditionId: "bramblewick",
    level: 9,
    scars: [],
    generation: 1,
    seededAt: 0,
    misses: 0,
    ...overrides,
  };
}

/** A minimal, fully self-contained tuning fixture — pinned rather than
 * read from `content/tuning.ts` (the `ailment.test.ts`/`catchup.test.ts`
 * discipline), so a retune of the shipped numbers can never quietly
 * change what these tests pin. */
const fixtureTuning: LineageTuning = {
  lifecycle: {
    lineage: {
      findChanceFirstTrip: 0.4,
      guaranteedAfterTrips: 2,
      lostParentLevelShare: 0.5,
      bredLevelShare: 0.35,
      shinyInheritChance: 0.5,
      breedMinLevel: 3,
      breedMinNeed: 60,
      breedCooldownMs: 24 * HOUR_MS,
      maxClutchesPerPip: 3,
      breedingIncubationMs: 4 * HOUR_MS,
    },
    ailments: { inheritedResistance: 0.25 },
  },
  breeding: { mutationChance: 0.05 },
};

describe("oldestUnfoundSeedFor", () => {
  it("returns undefined when no seed matches the biome", () => {
    expect(
      oldestUnfoundSeedFor([makeSeed({ expeditionId: "snowdrift" })], "bramblewick"),
    ).toBeUndefined();
    expect(oldestUnfoundSeedFor([], "bramblewick")).toBeUndefined();
  });

  it("picks the OLDEST matching seed by seededAt", () => {
    const older = makeSeed({ pipId: "pip-a", seededAt: 100 });
    const newer = makeSeed({ pipId: "pip-b", seededAt: 200 });
    expect(oldestUnfoundSeedFor([newer, older], "bramblewick")).toBe(older);
  });

  it("ignores seeds for other biomes even when interleaved", () => {
    const target = makeSeed({ pipId: "pip-a", expeditionId: "bramblewick", seededAt: 50 });
    const other = makeSeed({ pipId: "pip-b", expeditionId: "snowdrift", seededAt: 10 });
    expect(oldestUnfoundSeedFor([other, target], "bramblewick")).toBe(target);
  });
});

describe("lineageFindChance", () => {
  it("is findChanceFirstTrip when misses is 0 (the first qualifying trip)", () => {
    expect(lineageFindChance(makeSeed({ misses: 0 }), fixtureTuning)).toBe(0.4);
  });

  it("is guaranteed (1) from the second qualifying trip on (misses >= 1)", () => {
    expect(lineageFindChance(makeSeed({ misses: 1 }), fixtureTuning)).toBe(1);
    expect(lineageFindChance(makeSeed({ misses: 5 }), fixtureTuning)).toBe(1);
  });

  it("expected trips to find = 1.6, the bible's own §5.2 arithmetic", () => {
    const cfg = fixtureTuning.lifecycle.lineage;
    const expectedTrips = 1 * cfg.findChanceFirstTrip + 2 * (1 - cfg.findChanceFirstTrip);
    expect(expectedTrips).toBeCloseTo(1.6, 5);
  });
});

describe("attemptLineageFind", () => {
  it("consumes ZERO rolls when there is no unfound seed for the biome", () => {
    const rng = createRng(1);
    const stream = rng.stream(LINEAGE_STREAM);
    const before = stream.getState();
    const outcome = attemptLineageFind([], "bramblewick", stream, fixtureTuning);
    expect(outcome).toEqual({ kind: "none" });
    expect(stream.getState()).toBe(before);
  });

  it("consumes ZERO rolls when the only seed is for a DIFFERENT biome", () => {
    const rng = createRng(1);
    const stream = rng.stream(LINEAGE_STREAM);
    const before = stream.getState();
    const outcome = attemptLineageFind(
      [makeSeed({ expeditionId: "snowdrift" })],
      "bramblewick",
      stream,
      fixtureTuning,
    );
    expect(outcome).toEqual({ kind: "none" });
    expect(stream.getState()).toBe(before);
  });

  it("a miss consumes exactly one roll and increments misses on that seed only", () => {
    let outcome: ReturnType<typeof attemptLineageFind> | undefined;
    let missSeed = -1;
    for (let s = 1; s < 2000; s++) {
      const rng = createRng(s);
      const stream = rng.stream(LINEAGE_STREAM);
      const candidate = attemptLineageFind([makeSeed()], "bramblewick", stream, fixtureTuning);
      if (candidate.kind === "miss") {
        outcome = candidate;
        missSeed = s;
        break;
      }
    }
    expect(missSeed, "no seed in range produced a miss — widen the search").toBeGreaterThan(0);
    if (outcome === undefined || outcome.kind !== "miss") return;
    expect(outcome.seeds).toHaveLength(1);
    expect(outcome.seeds[0]?.misses).toBe(1);
  });

  it("guaranteed on the second qualifying trip: misses >= 1 always finds, for every seed tried", () => {
    for (let s = 1; s < 50; s++) {
      const rng = createRng(s);
      const stream = rng.stream(LINEAGE_STREAM);
      const outcome = attemptLineageFind(
        [makeSeed({ misses: 1 })],
        "bramblewick",
        stream,
        fixtureTuning,
      );
      expect(outcome.kind).toBe("found");
    }
  });

  it("simulation: over 500 independent lines, every one is found within 2 qualifying trips, and roughly findChanceFirstTrip of them find on the first", () => {
    let foundOnFirst = 0;
    const trials = 500;
    for (let s = 1; s <= trials; s++) {
      const rng = createRng(s * 7919 + 3);
      const stream = rng.stream(LINEAGE_STREAM);
      let seeds: readonly LineageEggSeed[] = [makeSeed({ pipId: `pip-${s}` })];
      let trips = 0;
      let found = false;
      while (!found && trips < 2) {
        trips++;
        const outcome = attemptLineageFind(seeds, "bramblewick", stream, fixtureTuning);
        expect(outcome.kind).not.toBe("none");
        if (outcome.kind === "found") {
          found = true;
          if (trips === 1) foundOnFirst++;
        } else if (outcome.kind === "miss") {
          seeds = outcome.seeds;
        }
      }
      expect(found, `line ${s} was not found within 2 qualifying trips`).toBe(true);
    }
    const rate = foundOnFirst / trials;
    // 0.40 expected against real RNG draws; a wide tolerance band avoids
    // this test being seed-fragile while still catching a broken formula.
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.5);
  });

  it("found: removes the seed, and the total roll count is exactly 1 (find) + 6 (combine) + 1 (shiny) = 8", () => {
    const rng = createRng(9);
    const stream = rng.stream(LINEAGE_STREAM);
    const seed = makeSeed({ misses: 1 });
    const before = stream.getState();
    const outcome = attemptLineageFind([seed], "bramblewick", stream, fixtureTuning);
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.seed).toBe(seed);
    expect(outcome.seeds).toEqual([]);

    const rng2 = createRng(9);
    const stream2 = rng2.stream(LINEAGE_STREAM);
    for (let i = 0; i < 8; i++) stream2.next();
    expect(stream.getState()).toBe(stream2.getState());
    expect(stream.getState()).not.toBe(before);
  });

  it("inheritance: genome is combineGenomes(seed.genome, seed.genome, …) — the degenerate single-parent case", () => {
    const rng = createRng(3);
    const stream = rng.stream(LINEAGE_STREAM);
    const outcome = attemptLineageFind(
      [makeSeed({ misses: 1 })],
      "bramblewick",
      stream,
      fixtureTuning,
    );
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    // Both "parents" are the SAME genome, so species/personality (each a
    // 50/50-or-mutate pick between two IDENTICAL values) can only ever
    // land on the parent's own value.
    expect(outcome.inheritance.genome.speciesId).toBe("mosspip");
    expect(outcome.inheritance.genome.personalityId).toBe("curious");
  });

  it("inheritance: level is 1 + floor((parent.level - 1) * lostParentLevelShare) — the bible's own worked example (9 -> 5)", () => {
    const rng = createRng(11);
    const stream = rng.stream(LINEAGE_STREAM);
    const seed = makeSeed({ misses: 1, level: 9 });
    const outcome = attemptLineageFind([seed], "bramblewick", stream, fixtureTuning);
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.inheritance.level).toBe(5);
    expect(outcome.inheritance.generation).toBe(seed.generation + 1);
    expect(outcome.inheritance.parentIds).toEqual([seed.pipId]);
  });

  it("inheritance: resistances are the parent's scars at inheritedResistance each", () => {
    const rng = createRng(13);
    const stream = rng.stream(LINEAGE_STREAM);
    const seed = makeSeed({ misses: 1, scars: ["brambleburr", "chillshake"] });
    const outcome = attemptLineageFind([seed], "bramblewick", stream, fixtureTuning);
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.inheritance.resistances).toEqual({
      brambleburr: 0.25,
      chillshake: 0.25,
    });
  });

  it("shiny: a non-shiny parent's line can never produce a shiny child", () => {
    for (let s = 1; s < 100; s++) {
      const rng = createRng(s);
      const stream = rng.stream(LINEAGE_STREAM);
      const seed = makeSeed({
        misses: 1,
        genome: { ...makeSeed().genome, shiny: false },
      });
      const outcome = attemptLineageFind([seed], "bramblewick", stream, fixtureTuning);
      if (outcome.kind === "found") {
        expect(outcome.inheritance.genome.shiny).toBe(false);
      }
    }
  });

  it("shiny: a shiny parent's line can inherit shininess (roughly shinyInheritChance of the time)", () => {
    let shinyCount = 0;
    const trials = 300;
    for (let s = 1; s <= trials; s++) {
      const rng = createRng(s * 104729 + 1);
      const stream = rng.stream(LINEAGE_STREAM);
      const seed = makeSeed({ misses: 1, genome: { ...makeSeed().genome, shiny: true } });
      const outcome = attemptLineageFind([seed], "bramblewick", stream, fixtureTuning);
      if (outcome.kind === "found" && outcome.inheritance.genome.shiny) shinyCount++;
    }
    const rate = shinyCount / trials;
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.65);
  });

  it("a seed for a DIFFERENT biome is left untouched while the target biome's seed is resolved", () => {
    const rng = createRng(9);
    const stream = rng.stream(LINEAGE_STREAM);
    const other = makeSeed({ pipId: "pip-other", expeditionId: "snowdrift", misses: 0 });
    const target = makeSeed({ pipId: "pip-target", expeditionId: "bramblewick", misses: 1 });
    const outcome = attemptLineageFind([other, target], "bramblewick", stream, fixtureTuning);
    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.seeds).toEqual([other]);
  });
});

describe("breedEligibility", () => {
  const now = 1_000_000;

  it("ok: true for two eligible, distinct pips", () => {
    const pips = { a: makePip("a"), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({ ok: true });
  });

  it("samePip fires before any pip lookup", () => {
    expect(breedEligibility({}, "a", "a", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "samePip",
    });
  });

  it("unknownPip names whichever id is missing", () => {
    const pips = { a: makePip("a") };
    expect(breedEligibility(pips, "a", "ghost", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "unknownPip",
      pipId: "ghost",
    });
    expect(breedEligibility(pips, "ghost", "a", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "unknownPip",
      pipId: "ghost",
    });
  });

  it("notAdult for a Pipling", () => {
    const pips = { a: makePip("a", { lifeStage: LifeStage.Pipling }), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "notAdult",
      pipId: "a",
    });
  });

  it("levelTooLow below breedMinLevel", () => {
    const pips = { a: makePip("a", { level: 2 }), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "levelTooLow",
      pipId: "a",
    });
  });

  it("ailing while carrying an active ailment", () => {
    const pips = {
      a: makePip("a", {
        ailment: {
          id: "brambleburr",
          contractedAt: 0,
          fromExpeditionId: "bramblewick",
          remainingMs: 1,
          totalMs: 1,
          cureAttempts: 0,
        },
      }),
      b: makePip("b"),
    };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "ailing",
      pipId: "a",
    });
  });

  it("busy while OnExpedition or Returning", () => {
    const onExpedition = { a: makePip("a", { activity: PipActivity.OnExpedition }), b: makePip("b") };
    expect(breedEligibility(onExpedition, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "busy",
      pipId: "a",
    });
    const returning = { a: makePip("a", { activity: PipActivity.Returning }), b: makePip("b") };
    expect(breedEligibility(returning, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "busy",
      pipId: "a",
    });
  });

  it("sulking", () => {
    const pips = { a: makePip("a", { activity: PipActivity.Sulking }), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "sulking",
      pipId: "a",
    });
  });

  it("needsTooLow when any of the four needs is below breedMinNeed", () => {
    const pips = {
      a: makePip("a", { needs: { hunger: 59, cleanliness: 90, happiness: 90, energy: 90 } }),
      b: makePip("b"),
    };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "needsTooLow",
      pipId: "a",
    });
  });

  it("cooldown when bred within breedCooldownMs (wall-clock)", () => {
    const pips = { a: makePip("a", { lastBredAt: now - HOUR_MS }), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "cooldown",
      pipId: "a",
    });
  });

  it("cooldown clears once breedCooldownMs has elapsed", () => {
    const pips = { a: makePip("a", { lastBredAt: now - 24 * HOUR_MS }), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({ ok: true });
  });

  it("clutchesExhausted at maxClutchesPerPip", () => {
    const pips = { a: makePip("a", { clutches: 3 }), b: makePip("b") };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "clutchesExhausted",
      pipId: "a",
    });
  });

  it("checks a fully before b — a's own failure is reported even if b also fails", () => {
    const pips = { a: makePip("a", { level: 1 }), b: makePip("b", { level: 1 }) };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "levelTooLow",
      pipId: "a",
    });
  });

  it("reports b's failure once a is fully eligible", () => {
    const pips = { a: makePip("a"), b: makePip("b", { level: 1 }) };
    expect(breedEligibility(pips, "a", "b", now, fixtureTuning)).toEqual({
      ok: false,
      reason: "levelTooLow",
      pipId: "b",
    });
  });
});

describe("combineForBreeding", () => {
  it("consumes exactly 7 rolls (6 combineGenomes + 1 shiny), always", () => {
    const rng = createRng(5);
    const stream = rng.stream(LINEAGE_STREAM);
    combineForBreeding(makePip("a"), makePip("b"), stream, fixtureTuning);

    const rng2 = createRng(5);
    const stream2 = rng2.stream(LINEAGE_STREAM);
    for (let i = 0; i < 7; i++) stream2.next();
    expect(stream.getState()).toBe(stream2.getState());
  });

  it("level: the bible's own worked example — two level-8 parents produce a level-3 child", () => {
    const rng = createRng(2);
    const stream = rng.stream(LINEAGE_STREAM);
    const inheritance = combineForBreeding(
      makePip("a", { level: 8 }),
      makePip("b", { level: 8 }),
      stream,
      fixtureTuning,
    );
    expect(inheritance.level).toBe(3);
  });

  it("level: handles a fractional mean correctly (level 8 + level 9 parents)", () => {
    const rng = createRng(4);
    const stream = rng.stream(LINEAGE_STREAM);
    const inheritance = combineForBreeding(
      makePip("a", { level: 8 }),
      makePip("b", { level: 9 }),
      stream,
      fixtureTuning,
    );
    // mean = 8.5, (8.5 - 1) * 0.35 = 2.625, floor = 2, + 1 = 3.
    expect(inheritance.level).toBe(3);
  });

  it("bred level share is LOWER than lineage's (0.35 < 0.50) at the same base level — a lost parent's legacy is the stronger inheritance", () => {
    const rng = createRng(15);
    const stream = rng.stream(LINEAGE_STREAM);
    const bred = combineForBreeding(
      makePip("a", { level: 9 }),
      makePip("b", { level: 9 }),
      stream,
      fixtureTuning,
    );
    const lostShareLevel =
      1 + Math.floor((9 - 1) * fixtureTuning.lifecycle.lineage.lostParentLevelShare);
    expect(bred.level).toBeLessThan(lostShareLevel);
  });

  it("parentIds is [a.id, b.id] in order, and generation is max(genA, genB) + 1", () => {
    const rng = createRng(6);
    const stream = rng.stream(LINEAGE_STREAM);
    const inheritance = combineForBreeding(
      makePip("a", { generation: 2 }),
      makePip("b", { generation: 5 }),
      stream,
      fixtureTuning,
    );
    expect(inheritance.parentIds).toEqual(["a", "b"]);
    expect(inheritance.generation).toBe(6);
  });

  it("resistances are the UNION of both parents' scars", () => {
    const rng = createRng(8);
    const stream = rng.stream(LINEAGE_STREAM);
    const inheritance = combineForBreeding(
      makePip("a", { scars: ["brambleburr"] }),
      makePip("b", { scars: ["chillshake", "brambleburr"] }),
      stream,
      fixtureTuning,
    );
    expect(inheritance.resistances).toEqual({ brambleburr: 0.25, chillshake: 0.25 });
  });

  it("genome.speciesId is always one of the two parents' BIRTH species — the Album cannot be trivialised", () => {
    const a = makePip("a", { genome: { ...makePip("a").genome, speciesId: "mosspip" } });
    const b = makePip("b", { genome: { ...makePip("b").genome, speciesId: "pebblepip" } });
    const seenSpecies = new Set<string>();
    for (let s = 1; s < 200; s++) {
      const rng = createRng(s);
      const stream = rng.stream(LINEAGE_STREAM);
      const inheritance = combineForBreeding(a, b, stream, fixtureTuning);
      expect(["mosspip", "pebblepip"]).toContain(inheritance.genome.speciesId);
      seenSpecies.add(inheritance.genome.speciesId);
    }
    // Both parents' species are actually reachable (not a constant-fold).
    expect(seenSpecies.size).toBe(2);
  });

  it("shiny: never shiny when neither parent is", () => {
    for (let s = 1; s < 100; s++) {
      const rng = createRng(s);
      const stream = rng.stream(LINEAGE_STREAM);
      const inheritance = combineForBreeding(makePip("a"), makePip("b"), stream, fixtureTuning);
      expect(inheritance.genome.shiny).toBe(false);
    }
  });

  it("shiny: can inherit when EITHER parent is shiny (applies from a OR b)", () => {
    let anyFromA = false;
    let anyFromB = false;
    for (let s = 1; s < 400 && !(anyFromA && anyFromB); s++) {
      const rng = createRng(s);
      const stream = rng.stream(LINEAGE_STREAM);
      const aShiny = makePip("a", { genome: { ...makePip("a").genome, shiny: true } });
      if (combineForBreeding(aShiny, makePip("b"), stream, fixtureTuning).genome.shiny) {
        anyFromA = true;
      }
      const rngB = createRng(s + 100_000);
      const streamB = rngB.stream(LINEAGE_STREAM);
      const bShiny = makePip("b", { genome: { ...makePip("b").genome, shiny: true } });
      if (combineForBreeding(makePip("a"), bShiny, streamB, fixtureTuning).genome.shiny) {
        anyFromB = true;
      }
    }
    expect(anyFromA).toBe(true);
    expect(anyFromB).toBe(true);
  });
});

/**
 * AILMENTS + THE LOSS PATH — the pure state machine (spec §16 v1.5,
 * docs/lifecycle-bible.md §3–§5, §7): contraction, stage derivation, the
 * vigil floor, cure attempts, and `resolveAilments`'s shields/true-loss
 * split. End-to-end reducer wiring (the poultice GIVE_ITEM route, TICK's
 * sole call site of `resolveAilments`, the countdown decrementing through
 * `needs.ts`) is `core/state.ailments.test.ts`'s job; this file tests
 * `ailment.ts` in isolation, the same division of labour `level.test.ts`
 * vs `level.balance.test.ts` already uses.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { HOUR_MS, tuning as contentTuning } from "../../content/tuning";
import { ailments as contentAilments } from "../../content/ailments";
import { LifeStage, PipActivity } from "./types";
import type { AilmentState, PipState } from "./types";
import {
  AILMENT_GRACE_COUNTER_KEY,
  AILMENT_STREAM,
  ailmentForExpedition,
  ailmentStage,
  applyDevotedCare,
  applyVigilFloor,
  attemptCure,
  devotedCareEligible,
  resolveAilments,
  rollContraction,
} from "./ailment";
import type { AilmentHostState, AilmentRegistry, AilmentTuning } from "./ailment";

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
    needs: { hunger: 100, cleanliness: 100, happiness: 100, energy: 100 },
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

function makeAilment(overrides: Partial<AilmentState> = {}): AilmentState {
  return {
    id: "brambleburr",
    contractedAt: 0,
    fromExpeditionId: "bramblewick",
    remainingMs: 48 * HOUR_MS,
    totalMs: 48 * HOUR_MS,
    cureAttempts: 0,
    ...overrides,
  };
}

/** A minimal, fully self-contained tuning fixture — pinned rather than
 * read from `content/tuning.ts`, the same discipline `catchup.test.ts`
 * uses, so a retune of the shipped numbers can never quietly change what
 * these tests pin. */
const fixtureTuning: AilmentTuning = {
  lifecycle: {
    ailments: {
      minDurationMs: 36 * HOUR_MS,
      vigilFloorMs: 4 * HOUR_MS,
      stages: { settling: 0.6, worsening: 0.25 },
      poulticeCureChance: 0.5,
      devotedCareCureChance: 0.3,
      devotedCareNeedFloor: 70,
      cureEscalationPerAttempt: 0.1,
      cureBonusMax: 0.45,
      contractReductionMax: 0.6,
      inheritedResistance: 0.25,
    },
    shields: {
      noLossBeforeLifeMs: 3 * 24 * HOUR_MS,
      firstLossGrace: true,
    },
  },
  offlineRateCapMs: 16 * HOUR_MS,
  retention: { sanctuary: { minActivePips: 1 } },
};

const TEST_REGISTRY: AilmentRegistry = {
  brambleburr: {
    id: "brambleburr",
    fromExpeditionId: "bramblewick",
    totalMs: 48 * HOUR_MS,
    contractChance: 0.5,
  },
};

describe("ailmentStage — derived, never stored", () => {
  it("settling at and above the settling band", () => {
    expect(ailmentStage(makeAilment({ remainingMs: 30, totalMs: 50 }), fixtureTuning)).toBe(
      "settling",
    ); // 0.6 exactly
    expect(ailmentStage(makeAilment({ remainingMs: 50, totalMs: 50 }), fixtureTuning)).toBe(
      "settling",
    );
  });

  it("worsening between the two bands", () => {
    expect(ailmentStage(makeAilment({ remainingMs: 29, totalMs: 50 }), fixtureTuning)).toBe(
      "worsening",
    );
    expect(ailmentStage(makeAilment({ remainingMs: 12.5, totalMs: 50 }), fixtureTuning)).toBe(
      "worsening",
    ); // 0.25 exactly
  });

  it("grave below the worsening floor", () => {
    expect(ailmentStage(makeAilment({ remainingMs: 12, totalMs: 50 }), fixtureTuning)).toBe(
      "grave",
    );
    expect(ailmentStage(makeAilment({ remainingMs: 0, totalMs: 50 }), fixtureTuning)).toBe(
      "grave",
    );
  });
});

describe("ailmentForExpedition", () => {
  it("finds the one ailment a deep biome carries", () => {
    expect(ailmentForExpedition(contentAilments, "bramblewick")?.id).toBe("brambleburr");
    expect(ailmentForExpedition(contentAilments, "snowdrift")?.id).toBe("chillshake");
    expect(ailmentForExpedition(contentAilments, "lanterngrotto")?.id).toBe("lanternfever");
  });

  it("finds nothing for a safe (quick) trip — the whole point of promise 1", () => {
    expect(ailmentForExpedition(contentAilments, "meadow")).toBeUndefined();
    expect(ailmentForExpedition(contentAilments, "forest")).toBeUndefined();
    expect(ailmentForExpedition(contentAilments, "shore")).toBeUndefined();
  });

  it("finds nothing for an unknown biome id (defensive)", () => {
    expect(ailmentForExpedition(contentAilments, "nowhere")).toBeUndefined();
  });
});

describe("PROMISE 1's mechanism — asserted directly (bible §3.3 rule 1)", () => {
  it("minDurationMs exceeds offlineRateCapMs: a healthy Pip can never be critical on return", () => {
    expect(contentTuning.lifecycle.ailments.minDurationMs).toBeGreaterThan(
      contentTuning.offlineRateCapMs,
    );
  });

  it("every shipped ailment's totalMs is at least minDurationMs, and exceeds offlineRateCapMs", () => {
    for (const def of Object.values(contentAilments)) {
      expect(
        def.totalMs,
        `${def.id}.totalMs must be >= minDurationMs`,
      ).toBeGreaterThanOrEqual(contentTuning.lifecycle.ailments.minDurationMs);
      expect(def.totalMs).toBeGreaterThan(contentTuning.offlineRateCapMs);
    }
  });

  it("every shipped ailment is inflicted by exactly one DEEP (risky) biome, never a quick/safe one", () => {
    const safeBiomes = ["meadow", "forest", "shore"];
    for (const def of Object.values(contentAilments)) {
      expect(safeBiomes).not.toContain(def.fromExpeditionId);
    }
  });
});

describe("rollContraction — deterministic, and zero rolls when it cannot apply", () => {
  it("is deterministic: the same seed and inputs always produce the same outcome", () => {
    const a = rollContraction(
      makePip(),
      "bramblewick",
      createRng(42).stream(AILMENT_STREAM),
      TEST_REGISTRY,
      0,
      fixtureTuning,
    );
    const b = rollContraction(
      makePip(),
      "bramblewick",
      createRng(42).stream(AILMENT_STREAM),
      TEST_REGISTRY,
      0,
      fixtureTuning,
    );
    expect(a).toEqual(b);
  });

  it("consumes exactly one roll when a roll is actually possible", () => {
    const rng = createRng(7);
    const stream = rng.stream(AILMENT_STREAM);
    rollContraction(makePip(), "bramblewick", stream, TEST_REGISTRY, 0, fixtureTuning);
    const cursorAfterOne = stream.getState();
    const freshSameSeed = createRng(7).stream(AILMENT_STREAM);
    freshSameSeed.next(); // exactly one manual roll from the same seed
    expect(cursorAfterOne).toBe(freshSameSeed.getState());
  });

  it("a safe (quick) trip never contracts anything and consumes ZERO rolls", () => {
    const rng = createRng(7);
    const stream = rng.stream(AILMENT_STREAM);
    const before = stream.getState();
    const result = rollContraction(makePip(), "meadow", stream, TEST_REGISTRY, 0, fixtureTuning);
    expect(result).toBeNull();
    expect(stream.getState()).toBe(before); // untouched — no roll at all
  });

  it("an already-ailing Pip never contracts a second ailment, ZERO rolls", () => {
    const rng = createRng(7);
    const stream = rng.stream(AILMENT_STREAM);
    const before = stream.getState();
    const ailing = makePip({ ailment: makeAilment() });
    const result = rollContraction(ailing, "bramblewick", stream, TEST_REGISTRY, 0, fixtureTuning);
    expect(result).toBeNull();
    expect(stream.getState()).toBe(before);
  });

  it("a SCAR is a permanent immunity — the roll is skipped entirely, ZERO rolls", () => {
    const rng = createRng(7);
    const stream = rng.stream(AILMENT_STREAM);
    const before = stream.getState();
    const scarred = makePip({ scars: ["brambleburr"] });
    const result = rollContraction(
      scarred,
      "bramblewick",
      stream,
      TEST_REGISTRY,
      0,
      fixtureTuning,
    );
    expect(result).toBeNull();
    expect(stream.getState()).toBe(before);
  });

  it("contractChance 1 always contracts; the shape is correct", () => {
    const guaranteed: AilmentRegistry = {
      brambleburr: {
        id: "brambleburr",
        fromExpeditionId: "bramblewick",
        totalMs: 48 * HOUR_MS,
        contractChance: 1,
      },
    };
    const result = rollContraction(
      makePip(),
      "bramblewick",
      createRng(1).stream(AILMENT_STREAM),
      guaranteed,
      12345,
      fixtureTuning,
    );
    expect(result).not.toBeNull();
    expect(result?.id).toBe("brambleburr");
    expect(result?.fromExpeditionId).toBe("bramblewick");
    expect(result?.contractedAt).toBe(12345);
    expect(result?.totalMs).toBe(48 * HOUR_MS); // level 1 → countdownExtend ×1
    expect(result?.remainingMs).toBe(result?.totalMs);
    expect(result?.cureAttempts).toBe(0);
  });

  it("contractChance 0 never contracts, but still consumes exactly one roll", () => {
    const never: AilmentRegistry = {
      brambleburr: {
        id: "brambleburr",
        fromExpeditionId: "bramblewick",
        totalMs: 48 * HOUR_MS,
        contractChance: 0,
      },
    };
    const rng = createRng(1);
    const stream = rng.stream(AILMENT_STREAM);
    const result = rollContraction(makePip(), "bramblewick", stream, never, 0, fixtureTuning);
    expect(result).toBeNull();
    const cursorAfter = stream.getState();
    const freshSameSeed = createRng(1).stream(AILMENT_STREAM);
    freshSameSeed.next();
    expect(cursorAfter).toBe(freshSameSeed.getState());
  });

  it("full contract-reduction (level + building) drives the effective chance to zero, deterministically", () => {
    const guaranteed: AilmentRegistry = {
      brambleburr: {
        id: "brambleburr",
        fromExpeditionId: "bramblewick",
        totalMs: 48 * HOUR_MS,
        contractChance: 1,
      },
    };
    const tuningWithFullReduction: AilmentTuning = {
      ...fixtureTuning,
      lifecycle: {
        ...fixtureTuning.lifecycle,
        level: { contractReduction: [1] }, // level 1 already reduces 100%
      },
    };
    const result = rollContraction(
      makePip(),
      "bramblewick",
      createRng(9).stream(AILMENT_STREAM),
      guaranteed,
      0,
      tuningWithFullReduction,
    );
    expect(result).toBeNull(); // chance was driven to exactly 0
  });

  it("a full inherited resistance for THIS ailment drives the effective chance to zero, deterministically", () => {
    const guaranteed: AilmentRegistry = {
      brambleburr: {
        id: "brambleburr",
        fromExpeditionId: "bramblewick",
        totalMs: 48 * HOUR_MS,
        contractChance: 1,
      },
    };
    const resistant = makePip({ resistances: { brambleburr: 1 } });
    const result = rollContraction(
      resistant,
      "bramblewick",
      createRng(9).stream(AILMENT_STREAM),
      guaranteed,
      0,
      fixtureTuning,
    );
    expect(result).toBeNull();
  });
});

describe("applyVigilFloor — a CATCH-UP-ONLY clamp", () => {
  it("clamps a countdown that fell below the floor DURING the pass back up to exactly the floor", () => {
    const before = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 10 * HOUR_MS }) }) };
    const after = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 1 * HOUR_MS }) }) };
    const result = applyVigilFloor(before, after, fixtureTuning);
    expect(result["pip-1"]?.ailment?.remainingMs).toBe(4 * HOUR_MS);
  });

  // ⚠️ PROMISE 2, THE CASE THE FIRST CUT GOT WRONG. A Pip already BELOW
  // the floor when the app closed keeps EVERY remaining minute: the clamp
  // is `min(before, floor)`, unconditionally. The earlier rule only
  // clamped when `before >= floor`, which made the floor a cliff — quit at
  // 3h59m and the absence ate the lot (the Pip died a minute after
  // reopening); quit at 4h01m and four hours were waiting. The countdown
  // is only ever allowed to be spent by time the player was there for.
  it("takes NOTHING from a countdown that was already below the floor before the absence", () => {
    const before = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 2 * HOUR_MS }) }) };
    const after = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 0.5 * HOUR_MS }) }) };
    const result = applyVigilFloor(before, after, fixtureTuning);
    expect(result["pip-1"]?.ailment?.remainingMs).toBe(2 * HOUR_MS);
  });

  it("never pushes a countdown BACKWARDS — the clamp is a lower bound only", () => {
    // Below the floor before AND after, but the pass took nothing (a Pip
    // whose ailment was untouched, or cured and re-contracted at a longer
    // remaining). `min(before, floor)` is a floor, never a target.
    const before = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 1 * HOUR_MS }) }) };
    const after = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 3 * HOUR_MS }) }) };
    const result = applyVigilFloor(before, after, fixtureTuning);
    expect(result["pip-1"]?.ailment?.remainingMs).toBe(3 * HOUR_MS);
  });

  // The regression this fix is FOR, stated as the arithmetic the audit
  // measured: every one of these returns with its full pre-absence
  // countdown, because every one of them started below the floor.
  it.each([0.5, 2, 3.9])(
    "a Pip who left with %sh of countdown comes back with exactly that, after any absence",
    (hours) => {
      const before = {
        "pip-1": makePip({ ailment: makeAilment({ remainingMs: hours * HOUR_MS }) }),
      };
      // A week away: the rated pass drove the countdown to zero.
      const after = { "pip-1": makePip({ ailment: makeAilment({ remainingMs: 0 }) }) };
      const result = applyVigilFloor(before, after, fixtureTuning);
      expect(result["pip-1"]?.ailment?.remainingMs).toBe(hours * HOUR_MS);
    },
  );

  it("is a no-op for a Pip with no ailment before or after", () => {
    const before = { "pip-1": makePip() };
    const after = { "pip-1": makePip({ needs: { hunger: 50, cleanliness: 50, happiness: 50, energy: 50 } }) };
    const result = applyVigilFloor(before, after, fixtureTuning);
    expect(result).toBe(after); // byte-identical reference — never touched
  });
});

describe("attemptCure", () => {
  it("returns null for a Pip with no active ailment", () => {
    expect(attemptCure(makePip(), "poultice", createRng(1).stream(AILMENT_STREAM), fixtureTuning)).toBeNull();
  });

  it("is deterministic given the same seed", () => {
    const ailing = makePip({ ailment: makeAilment() });
    const a = attemptCure(ailing, "poultice", createRng(3).stream(AILMENT_STREAM), fixtureTuning);
    const b = attemptCure(ailing, "poultice", createRng(3).stream(AILMENT_STREAM), fixtureTuning);
    expect(a).toEqual(b);
  });

  it("failure increments cureAttempts and changes nothing else", () => {
    const alwaysFail: AilmentTuning = {
      ...fixtureTuning,
      lifecycle: {
        ...fixtureTuning.lifecycle,
        ailments: { ...fixtureTuning.lifecycle.ailments, poulticeCureChance: 0, cureBonusMax: 0 },
      },
    };
    const ailing = makePip({ ailment: makeAilment({ cureAttempts: 2 }) });
    const result = attemptCure(ailing, "poultice", createRng(1).stream(AILMENT_STREAM), alwaysFail);
    expect(result?.cured).toBe(false);
    expect(result?.pip.ailment?.cureAttempts).toBe(3);
    expect(result?.pip.ailment?.remainingMs).toBe(ailing.ailment?.remainingMs);
    expect(result?.pip.scars).toBeUndefined();
  });

  it("success clears the ailment, adds a scar, and awards ailmentSurvivedPipXp", () => {
    const alwaysSucceed: AilmentTuning = {
      ...fixtureTuning,
      lifecycle: {
        ...fixtureTuning.lifecycle,
        ailments: { ...fixtureTuning.lifecycle.ailments, poulticeCureChance: 1 },
      },
    };
    const ailing = makePip({ ailment: makeAilment() });
    const result = attemptCure(ailing, "poultice", createRng(1).stream(AILMENT_STREAM), alwaysSucceed);
    expect(result?.cured).toBe(true);
    expect(result?.pip.ailment).toBeNull();
    expect(result?.pip.scars).toEqual(["brambleburr"]);
    expect(result?.pip.pipXp).toBe(contentTuning.lifecycle.level.xp.ailmentSurvived);
  });

  it("does not duplicate an already-held scar", () => {
    const alwaysSucceed: AilmentTuning = {
      ...fixtureTuning,
      lifecycle: {
        ...fixtureTuning.lifecycle,
        ailments: { ...fixtureTuning.lifecycle.ailments, poulticeCureChance: 1 },
      },
    };
    const ailing = makePip({ ailment: makeAilment(), scars: ["brambleburr"] });
    const result = attemptCure(ailing, "poultice", createRng(1).stream(AILMENT_STREAM), alwaysSucceed);
    expect(result?.pip.scars).toEqual(["brambleburr"]);
  });

  it("escalation makes the next attempt strictly likelier", () => {
    // Same first roll from the same seed either way (fresh streams); only
    // `cureAttempts` differs, so any success/failure flip is attributable
    // to escalation alone.
    const seed = 55;
    const base: AilmentTuning = {
      ...fixtureTuning,
      lifecycle: {
        ...fixtureTuning.lifecycle,
        ailments: {
          ...fixtureTuning.lifecycle.ailments,
          poulticeCureChance: 0.1,
          cureEscalationPerAttempt: 0.4,
          cureBonusMax: 1,
        },
      },
    };
    const fresh = createRng(seed).stream(AILMENT_STREAM);
    const roll = fresh.next(); // the exact draw both calls below will see

    const zeroAttempts = attemptCure(
      makePip({ ailment: makeAilment({ cureAttempts: 0 }) }),
      "poultice",
      createRng(seed).stream(AILMENT_STREAM),
      base,
    );
    const manyAttempts = attemptCure(
      makePip({ ailment: makeAilment({ cureAttempts: 3 }) }),
      "poultice",
      createRng(seed).stream(AILMENT_STREAM),
      base,
    );
    // chance(0 attempts) = 0.1, chance(3 attempts) = 0.1 + 0.4*3 = 1.3 → 1
    expect(roll).toBeGreaterThanOrEqual(0.1); // the 0-attempt roll fails
    expect(zeroAttempts?.cured).toBe(false);
    expect(manyAttempts?.cured).toBe(true); // escalated past the SAME roll
  });
});

/** A minimal AilmentHostState, structurally satisfying what
 * `resolveAilments` needs without pulling in the whole `GameState` shape
 * (the same `SanctuaryHostState`-style fixture discipline
 * `sanctuary.test.ts` already uses). */
function makeHost(overrides: Partial<AilmentHostState> = {}): AilmentHostState {
  return {
    pips: { "pip-1": makePip() },
    rosterOrder: ["pip-1"],
    activePipId: "pip-1",
    sanctuary: { pips: {}, order: [] },
    counters: {},
    keep: { level: 1 },
    ...overrides,
  };
}

describe("resolveAilments — the ONLY function that may ever remove a Pip", () => {
  it("does nothing for a Pip whose countdown has not yet run out", () => {
    const host = makeHost({
      pips: { "pip-1": makePip({ ailment: makeAilment({ remainingMs: HOUR_MS }) }) },
    });
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result).toBe(host); // byte-identical — nothing to resolve
  });

  it("defers resolution while the Pip is OnExpedition/Returning — never taken mid-trip", () => {
    for (const activity of [PipActivity.OnExpedition, PipActivity.Returning] as const) {
      const host = makeHost({
        rosterOrder: ["pip-1", "pip-2", "pip-3"],
        pips: {
          "pip-1": makePip({
            activity,
            ailment: makeAilment({ remainingMs: 0 }),
            lifeMs: 10 * 24 * HOUR_MS,
          }),
          "pip-2": makePip({ id: "pip-2" }),
          "pip-3": makePip({ id: "pip-3" }),
        },
        counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 }, // grace already spent
      });
      const result = resolveAilments(host, 1000, fixtureTuning);
      expect(result).toBe(host);
    }
  });

  it("THE LOYAL TURN fires when losing this Pip would empty the Keep (promise 5)", () => {
    const host = makeHost({
      pips: {
        "pip-1": makePip({ ailment: makeAilment({ remainingMs: 0 }), lifeMs: 10 * 24 * HOUR_MS }),
      },
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 }, // grace already spent — not the reason
    });
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]).toBeDefined();
    expect(result.pips["pip-1"]?.ailment).toBeNull();
    expect(result.pips["pip-1"]?.scars).toEqual(["brambleburr"]);
    expect(result.rosterOrder).toEqual(["pip-1"]);
    expect(result.lastLossOutcome).toEqual({
      kind: "loyalTurn",
      pipId: "pip-1",
      at: 1000,
      ailmentId: "brambleburr",
    });
  });

  it("THE LOYAL TURN fires for a young Pip (bible §7.3), even with roster to spare", () => {
    const host = makeHost({
      rosterOrder: ["pip-1", "pip-2", "pip-3"],
      pips: {
        "pip-1": makePip({ ailment: makeAilment({ remainingMs: 0 }), lifeMs: HOUR_MS }), // < 3 days
        "pip-2": makePip({ id: "pip-2" }),
        "pip-3": makePip({ id: "pip-3" }),
      },
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 },
    });
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]).toBeDefined();
    expect(result.rosterOrder.length).toBe(3);
  });

  it("THE LOYAL TURN fires on the save's first-ever grace, spending it exactly once", () => {
    const host = makeHost({
      rosterOrder: ["pip-1", "pip-2", "pip-3"],
      pips: {
        "pip-1": makePip({ ailment: makeAilment({ remainingMs: 0 }), lifeMs: 10 * 24 * HOUR_MS }),
        "pip-2": makePip({ id: "pip-2" }),
        "pip-3": makePip({ id: "pip-3" }),
      },
      counters: {}, // grace never used
    });
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]).toBeDefined();
    expect(result.counters[AILMENT_GRACE_COUNTER_KEY]).toBe(1);
  });

  it("a TRUE LOSS (every shield spent) removes the Pip, seeds a lineage egg, and records the Album-permanent memorial", () => {
    const host = makeHost({
      rosterOrder: ["pip-1", "pip-2", "pip-3"],
      activePipId: "pip-1",
      pips: {
        "pip-1": makePip({
          name: "Mossy",
          level: 5,
          scars: ["chillshake"],
          ailment: makeAilment({ remainingMs: 0 }),
          lifeMs: 10 * 24 * HOUR_MS,
        }),
        "pip-2": makePip({ id: "pip-2" }),
        "pip-3": makePip({ id: "pip-3" }),
      },
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 }, // no shield left
      lineageEggs: [],
    });
    const result = resolveAilments(host, 5000, fixtureTuning);

    // Removed from the active roster...
    expect(result.pips["pip-1"]).toBeUndefined();
    expect(result.rosterOrder).toEqual(["pip-2", "pip-3"]);
    // ...active pip reassigned (it was the retiree)...
    expect(result.activePipId).toBe("pip-2");
    // ...but the WHOLE Pip survives, verbatim, as a memorial (Album
    // permanence: nothing here deletes data, it MOVES).
    const record = result.sanctuary.pips["pip-1"];
    expect(record).toBeDefined();
    expect(record?.reason).toBe("lost");
    expect(record?.pip.name).toBe("Mossy");
    expect(record?.pip.level).toBe(5);
    expect(result.sanctuary.order).toEqual(["pip-1"]);

    // Promise 4 — a thread to pull, atomic with the loss.
    expect(result.lineageEggs?.length).toBe(1);
    expect(result.lineageEggs?.[0]).toEqual({
      pipId: "pip-1",
      name: "Mossy",
      genome: host.pips["pip-1"]?.genome,
      expeditionId: "bramblewick",
      level: 5,
      scars: ["chillshake"],
      generation: 1,
      seededAt: 5000,
      misses: 0,
    });

    expect(result.lastLossOutcome).toEqual({
      kind: "lost",
      pipId: "pip-1",
      at: 5000,
      ailmentId: "brambleburr",
      fromExpeditionId: "bramblewick",
    });
  });

  it("the one-place invariant holds after a loss: the id is in sanctuary XOR pips, never both, never neither", () => {
    const host = makeHost({
      rosterOrder: ["pip-1", "pip-2"],
      pips: {
        "pip-1": makePip({ ailment: makeAilment({ remainingMs: 0 }), lifeMs: 10 * 24 * HOUR_MS }),
        "pip-2": makePip({ id: "pip-2" }),
      },
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 },
    });
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]).toBeUndefined();
    expect(result.sanctuary.pips["pip-1"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ROUND 2H FIX PASS — the cruelty audit's findings, each as a test that
// fails against the behaviour that was actually shipped.
// ---------------------------------------------------------------------------

describe("applyDevotedCare — THE FREE ROUTE (bible §3.5)", () => {
  const DAY = 900;

  it("rolls for an ailing Pip whose every need clears the floor", () => {
    const host = makeHost({
      pips: { "pip-1": makePip({ ailment: makeAilment() }) },
    });
    expect(devotedCareEligible(host, DAY, fixtureTuning)).toEqual(["pip-1"]);
  });

  it("does NOT roll while any single need is under the floor", () => {
    const floor = fixtureTuning.lifecycle.ailments.devotedCareNeedFloor;
    for (const short of ["hunger", "cleanliness", "happiness", "energy"] as const) {
      const needs = { hunger: 100, cleanliness: 100, happiness: 100, energy: 100 };
      needs[short] = floor - 1;
      const host = makeHost({
        pips: { "pip-1": makePip({ needs, ailment: makeAilment() }) },
      });
      expect(devotedCareEligible(host, DAY, fixtureTuning)).toEqual([]);
    }
  });

  it("a freshly contracted ailment is eligible IMMEDIATELY — the first chance is never a day away", () => {
    const host = makeHost({
      pips: { "pip-1": makePip({ ailment: makeAilment({ lastCareRollDay: undefined }) }) },
    });
    expect(devotedCareEligible(host, DAY, fixtureTuning)).toEqual(["pip-1"]);
  });

  it("one roll per day: the same day is spent, the next day re-arms", () => {
    const host = makeHost({
      pips: { "pip-1": makePip({ ailment: makeAilment({ lastCareRollDay: DAY }) }) },
    });
    expect(devotedCareEligible(host, DAY, fixtureTuning)).toEqual([]);
    expect(devotedCareEligible(host, DAY + 1, fixtureTuning)).toEqual(["pip-1"]);
  });

  it("A DAY THE NEEDS NEVER CAME UP SPENDS NOTHING — the stamp is written only on a real roll", () => {
    // The rate limit must never become a deadline: a player who could not
    // get the needs up today has not USED today's chance, they simply had
    // no chance today. Tomorrow's is untouched.
    const host = makeHost({
      pips: {
        "pip-1": makePip({
          needs: { hunger: 10, cleanliness: 10, happiness: 10, energy: 10 },
          ailment: makeAilment(),
        }),
      },
    });
    const result = applyDevotedCare(
      host,
      1000,
      DAY,
      createRng(3).stream(AILMENT_STREAM),
      fixtureTuning,
    );
    expect(result).toBe(host); // byte-identical — nothing rolled, nothing stamped
    expect(result.pips["pip-1"]?.ailment?.lastCareRollDay).toBeUndefined();
  });

  it("a successful roll clears the ailment, scars, and stamps the cure echo", () => {
    // Seed search: find one whose first devotedCare roll succeeds.
    let seed = 1;
    let result = makeHost();
    for (; seed < 200; seed++) {
      const host = makeHost({
        pips: { "pip-1": makePip({ ailment: makeAilment() }) },
      });
      result = applyDevotedCare(
        host,
        1000,
        DAY,
        createRng(seed).stream(AILMENT_STREAM),
        fixtureTuning,
      );
      if (result.pips["pip-1"]?.ailment == null) break;
    }
    expect(result.pips["pip-1"]?.ailment).toBeNull();
    expect(result.pips["pip-1"]?.scars).toContain("brambleburr");
    expect(result.lastLossOutcome).toMatchObject({
      kind: "cured",
      pipId: "pip-1",
      route: "devotedCare",
    });
  });

  it("a failed roll costs the day but banks escalation for the next one", () => {
    let seed = 1;
    let result = makeHost();
    for (; seed < 200; seed++) {
      const host = makeHost({
        pips: { "pip-1": makePip({ ailment: makeAilment() }) },
      });
      result = applyDevotedCare(
        host,
        1000,
        DAY,
        createRng(seed).stream(AILMENT_STREAM),
        fixtureTuning,
      );
      if (result.pips["pip-1"]?.ailment != null) break;
    }
    expect(result.pips["pip-1"]?.ailment?.cureAttempts).toBe(1);
    expect(result.pips["pip-1"]?.ailment?.lastCareRollDay).toBe(DAY);
    expect(result.lastLossOutcome).toBeUndefined();
  });

  // THE MEASUREMENT. The audit found 0 cures in 100 runs of perfect care,
  // because nothing rolled this route at all. The bible's headline claim
  // (§3.5) rests entirely on it, so it is pinned here rather than left to
  // a comment.
  it("PROMISE 1: devoted care ALONE saves most Pips — 3 free rolls, no poultice, level 1", () => {
    const N = 400;
    let cured = 0;
    for (let seed = 1; seed <= N; seed++) {
      let host: AilmentHostState = makeHost({
        pips: { "pip-1": makePip({ ailment: makeAilment() }) },
      });
      const stream = createRng(seed).stream(AILMENT_STREAM);
      // The three rolls a 36h+ countdown affords a devoted player: the
      // contraction day plus the two day boundaries it spans.
      for (let day = DAY; day < DAY + 3; day++) {
        host = applyDevotedCare(host, 1000, day, stream, fixtureTuning);
        if (host.pips["pip-1"]?.ailment == null) break;
      }
      if (host.pips["pip-1"]?.ailment == null) cured++;
    }
    // 1 − (0.7 × 0.6 × 0.5) = 79% at the FIXTURE's odds (0.30 base, +0.10
    // per failed attempt). Shipped odds are kinder still (0.35 base).
    expect(cured / N).toBeGreaterThan(0.7);
  });
});

describe("resolveAilments — the shields, after the fix pass", () => {
  const oldEnough = { lifeMs: 10 * 24 * HOUR_MS };

  function threeRoster(pip1: Partial<PipState>): AilmentHostState {
    return makeHost({
      rosterOrder: ["pip-1", "pip-2", "pip-3"],
      pips: {
        "pip-1": makePip({ ...oldEnough, ailment: makeAilment({ remainingMs: 0 }), ...pip1 }),
        "pip-2": makePip({ id: "pip-2" }),
        "pip-3": makePip({ id: "pip-3" }),
      },
    });
  }

  // ⚠️ SHIELD 4, the once-ever grace. It used to be spent whenever it was
  // merely AVAILABLE — so a Loyal Turn fired by the young shield (a Pip
  // that was never at risk) silently burned it in week one, and it was
  // gone by the time the player owned a Pip that could genuinely be lost.
  it("the young shield does NOT spend the once-ever grace", () => {
    const host = threeRoster({ lifeMs: 1 * 24 * HOUR_MS }); // inside the 3-day shield
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]).toBeDefined(); // survived
    expect(result.pips["pip-1"]?.ailment).toBeNull();
    expect(result.counters[AILMENT_GRACE_COUNTER_KEY] ?? 0).toBe(0); // STILL THERE
  });

  it("the last-Pip shield does NOT spend the once-ever grace", () => {
    const host = makeHost({
      rosterOrder: ["pip-1"],
      pips: { "pip-1": makePip({ ...oldEnough, ailment: makeAilment({ remainingMs: 0 }) }) },
    });
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]?.ailment).toBeNull();
    expect(result.counters[AILMENT_GRACE_COUNTER_KEY] ?? 0).toBe(0);
  });

  it("the grace IS spent when it is the shield actually doing the work", () => {
    const host = threeRoster({});
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]?.ailment).toBeNull();
    expect(result.counters[AILMENT_GRACE_COUNTER_KEY]).toBe(1);
  });

  it("a Quiet Keep can never lose a Pip, at any age, with the grace long spent", () => {
    const host: AilmentHostState = {
      ...threeRoster({}),
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 },
      settings: { quietKeep: true },
    };
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.pips["pip-1"]).toBeDefined();
    expect(result.pips["pip-1"]?.ailment).toBeNull();
    expect(result.lastLossOutcome?.kind).toBe("loyalTurn");
    // ...and the Quiet Keep is free: it never spends the grace either.
    expect(result.counters[AILMENT_GRACE_COUNTER_KEY]).toBe(1);
  });

  // PROMISE 4 — the seed must carry the LOST PIP'S OWN generation. A
  // literal 1 collapsed every recovered line back to generation 2 forever
  // (`inheritFromLineageSeed` hatches at `seed.generation + 1`), so a line
  // could never climb, however many times it was recovered.
  it("the lineage egg records the lost Pip's OWN generation, not 1", () => {
    for (const generation of [1, 2, 5]) {
      const host: AilmentHostState = {
        ...threeRoster({ generation }),
        counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 },
      };
      const result = resolveAilments(host, 1000, fixtureTuning);
      expect(result.pips["pip-1"]).toBeUndefined();
      expect(result.lineageEggs?.[0]?.generation).toBe(generation);
    }
  });

  it("a Pip with no generation recorded seeds at 1 (original stock)", () => {
    const host: AilmentHostState = {
      ...threeRoster({}),
      counters: { [AILMENT_GRACE_COUNTER_KEY]: 1 },
    };
    const result = resolveAilments(host, 1000, fixtureTuning);
    expect(result.lineageEggs?.[0]?.generation).toBe(1);
  });
});

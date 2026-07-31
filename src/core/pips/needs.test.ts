/**
 * Phase 1 gate tests for needs math (spec §4.1, §4.2, §4.6, §13):
 * exact-value decay, the five personality rows asserted numerically,
 * multiplicative pipling stacking, situational modifiers, clamping,
 * and happinessIntegral accrual. All time deltas are driven by FakeClock.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, tuning } from "../../content/tuning";
import { LifeStage, PipActivity } from "./types";
import type { PipNeeds, PipState } from "./types";
import {
  accrueFrozenTime,
  applyNeedsDelta,
  effectiveRates,
  type NeedsTuning,
} from "./needs";

/**
 * FIXTURE numbers, deliberately PINNED rather than read from
 * `content/tuning.ts`.
 *
 * This file tests the needs ENGINE — multiplicative stacking order,
 * clamping, the clamped-trapezoid integral, frozen-time accrual — and it
 * does so with hand-checkable arithmetic (−6 × 1.2 × 1.2, 100 − 36, …).
 * Pinning the inputs is what lets those assertions stay readable and
 * bit-exact. Balance passes must NOT ripple through here: the shipped
 * decay curve is owned and asserted by `core/pips/balance.test.ts`, which
 * is the file that should light up when someone retunes the game.
 */
const FIXTURE_RATES = {
  hunger: -6,
  cleanliness: -4,
  happiness: -5,
  energy: -3,
} as const;

const FIXTURE_PERSONALITIES = {
  lazy: { hunger: 0.8, cleanliness: 1.0, happiness: 1.0, energy: 1.4 },
  curious: { hunger: 1.0, cleanliness: 1.2, happiness: 0.8, energy: 1.1 },
  hardworking: { hunger: 1.2, cleanliness: 1.0, happiness: 1.1, energy: 1.2 },
  chaotic: { hunger: 1.1, cleanliness: 1.5, happiness: 0.7, energy: 1.0 },
  clingy: { hunger: 1.0, cleanliness: 1.0, happiness: 1.3, energy: 0.9 },
  neutral: { hunger: 1, cleanliness: 1, happiness: 1, energy: 1 },
} as const;

const FIXTURE_PIPLING = { decayMultiplier: 1.2 } as const;
const FIXTURE_CARE = {
  rest: { energyPerHour: 15, autoWakeAtEnergy: 100 },
} as const;

/** The full fixture, used wherever a test exercises the personality table. */
const fixtureTuning: NeedsTuning = {
  needDecayPerHour: FIXTURE_RATES,
  personalityDecayMultipliers: FIXTURE_PERSONALITIES,
  quirks: tuning.quirks,
  pipling: FIXTURE_PIPLING,
  care: FIXTURE_CARE,
};

/** Neutral-only view of the same fixture (all ×1.0 multipliers). */
const neutralTuning: NeedsTuning = {
  ...fixtureTuning,
  personalityDecayMultipliers: { neutral: FIXTURE_PERSONALITIES.neutral },
};

const fullNeeds = (): PipNeeds => ({
  hunger: 100,
  cleanliness: 100,
  happiness: 100,
  energy: 100,
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
      personalityId: "neutral",
      shiny: false,
    },
    personalityId: "neutral",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: fullNeeds(),
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

/** Advance the FakeClock and return elapsed hours since the last recompute. */
function advanceHours(clock: FakeClock, pip: PipState, ms: number): number {
  clock.advance(ms);
  return (clock.now() - pip.needsUpdatedAt) / HOUR_MS;
}

describe("applyNeedsDelta — exact decay (Phase 1 gate)", () => {
  it("6h at base hunger −6/h on a neutral adult drops Hunger by exactly 36", () => {
    const clock = new FakeClock(1_700_000_000_000);
    const pip = makePip({ needsUpdatedAt: clock.now(), hatchedAt: clock.now() });
    const hours = advanceHours(clock, pip, 6 * HOUR_MS);

    const after = applyNeedsDelta(pip, hours, neutralTuning);

    expect(after.needs.hunger).toBe(64); // 100 − 36, ±0
    expect(after.needsUpdatedAt).toBe(clock.now());
    expect(after.ageMs).toBe(6 * HOUR_MS);
  });

  it("fractional advance (1.5h) decays every need exactly", () => {
    const clock = new FakeClock();
    const pip = makePip({ needsUpdatedAt: clock.now() });
    const hours = advanceHours(clock, pip, 1.5 * HOUR_MS);

    const after = applyNeedsDelta(pip, hours, neutralTuning);

    expect(after.needs.hunger).toBe(100 - 9); // −6 × 1.5
    expect(after.needs.cleanliness).toBe(100 - 6); // −4 × 1.5
    expect(after.needs.happiness).toBe(100 - 7.5); // −5 × 1.5
    expect(after.needs.energy).toBe(100 - 4.5); // −3 × 1.5
    expect(after.needsUpdatedAt).toBe(1.5 * HOUR_MS);
  });

  it("multi-hour advance in two segments equals one big advance exactly", () => {
    const clock = new FakeClock();
    const start = makePip({ needsUpdatedAt: clock.now() });

    // Segmented: 2h then 3.5h.
    clock.advance(2 * HOUR_MS);
    const mid = applyNeedsDelta(
      start,
      (clock.now() - start.needsUpdatedAt) / HOUR_MS,
      neutralTuning,
    );
    clock.advance(3.5 * HOUR_MS);
    const segmented = applyNeedsDelta(
      mid,
      (clock.now() - mid.needsUpdatedAt) / HOUR_MS,
      neutralTuning,
    );

    // Single 5.5h pass over an identical pip.
    const single = applyNeedsDelta(makePip(), 5.5, neutralTuning);

    expect(segmented.needs).toEqual(single.needs);
    expect(segmented.needs.hunger).toBe(100 - 33); // −6 × 5.5, exact
    expect(segmented.ageMs).toBe(single.ageMs);
    expect(segmented.happinessIntegral).toBe(single.happinessIntegral);
  });

  it("does not mutate the input pip (pure function)", () => {
    const pip = makePip();
    const snapshot = structuredClone(pip);
    applyNeedsDelta(pip, 6, neutralTuning);
    expect(pip).toEqual(snapshot);
  });

  it("negative hours clamp to 0 — never negative decay (spec §4.5)", () => {
    const pip = makePip();
    const after = applyNeedsDelta(pip, -2, neutralTuning);
    expect(after.needs).toEqual(pip.needs);
    expect(after.ageMs).toBe(pip.ageMs);
    expect(after.happinessIntegral).toBe(pip.happinessIntegral);
    expect(after.needsUpdatedAt).toBe(pip.needsUpdatedAt);
  });
});

describe("effectiveRates — personality table (spec §4.2, asserted numerically)", () => {
  // Base rates per §4.1: hunger −6, cleanliness −4, happiness −5, energy −3.
  // Expected = base × multiplier, multiplied in the same order as the
  // implementation (base × personality × lifestage × situational) so
  // float equality is exact.
  const rows = [
    ["lazy", { hunger: -6 * 0.8, cleanliness: -4 * 1.0, happiness: -5 * 1.0, energy: -3 * 1.4 }],
    ["curious", { hunger: -6 * 1.0, cleanliness: -4 * 1.2, happiness: -5 * 0.8, energy: -3 * 1.1 }],
    ["hardworking", { hunger: -6 * 1.2, cleanliness: -4 * 1.0, happiness: -5 * 1.1, energy: -3 * 1.2 }],
    ["chaotic", { hunger: -6 * 1.1, cleanliness: -4 * 1.5, happiness: -5 * 0.7, energy: -3 * 1.0 }],
    ["clingy", { hunger: -6 * 1.0, cleanliness: -4 * 1.0, happiness: -5 * 1.3, energy: -3 * 0.9 }],
  ] as const;

  it.each(rows)("%s adult idle rates match the spec table", (personalityId, expected) => {
    const rates = effectiveRates(makePip({ personalityId }), fixtureTuning);
    expect(rates.hunger).toBe(expected.hunger);
    expect(rates.cleanliness).toBe(expected.cleanliness);
    expect(rates.happiness).toBe(expected.happiness);
    expect(rates.energy).toBe(expected.energy);
  });

  it("throws on a personality id missing from tuning", () => {
    expect(() => effectiveRates(makePip({ personalityId: "mysterious" }), fixtureTuning)).toThrow(
      /unknown personalityId "mysterious"/,
    );
  });
});

describe("effectiveRates — pipling ×1.2 stacks multiplicatively (spec §4.1/§4.6)", () => {
  it("Hardworking pipling hunger = −6 × 1.2 × 1.2", () => {
    const rates = effectiveRates(
      makePip({ personalityId: "hardworking", lifeStage: LifeStage.Pipling }),
      fixtureTuning,
    );
    expect(rates.hunger).toBe(-6 * 1.2 * 1.2); // multiplicative, NOT −6 × 1.4
    expect(rates.hunger).not.toBe(-6 * (1.2 + 0.2)); // guard against additive stacking
  });

  it("Lazy pipling energy = −3 × 1.4 × 1.2", () => {
    const rates = effectiveRates(
      makePip({ personalityId: "lazy", lifeStage: LifeStage.Pipling }),
      fixtureTuning,
    );
    expect(rates.energy).toBe(-3 * 1.4 * 1.2);
  });

  it("neutral pipling gets exactly the ×1.2 life-stage factor", () => {
    const rates = effectiveRates(
      makePip({ lifeStage: LifeStage.Pipling }),
      neutralTuning,
    );
    expect(rates.hunger).toBe(-6 * 1.2);
    expect(rates.cleanliness).toBe(-4 * 1.2);
    expect(rates.happiness).toBe(-5 * 1.2);
    expect(rates.energy).toBe(-3 * 1.2);
  });
});

describe("effectiveRates — situational modifiers", () => {
  it("Clingy happiness decays ×2.0 while OnExpedition", () => {
    const rates = effectiveRates(
      makePip({ personalityId: "clingy", activity: PipActivity.OnExpedition }),
      fixtureTuning,
    );
    expect(rates.happiness).toBe(-5 * 1.3 * 1 * 2.0);
  });

  it("Clingy happiness decays ×2.0 while Returning too (the whole time away)", () => {
    const rates = effectiveRates(
      makePip({ personalityId: "clingy", activity: PipActivity.Returning }),
      fixtureTuning,
    );
    expect(rates.happiness).toBe(-5 * 1.3 * 1 * 2.0);
  });

  it("Clingy at home has no expedition penalty", () => {
    const rates = effectiveRates(makePip({ personalityId: "clingy" }), fixtureTuning);
    expect(rates.happiness).toBe(-5 * 1.3);
  });

  it("non-Clingy Pips get no ×2.0 while away", () => {
    const rates = effectiveRates(
      makePip({ personalityId: "curious", activity: PipActivity.OnExpedition }),
      fixtureTuning,
    );
    expect(rates.happiness).toBe(-5 * 0.8);
  });

  it("Clingy pipling on expedition stacks all four factors: −5 × 1.3 × 1.2 × 2.0", () => {
    const rates = effectiveRates(
      makePip({
        personalityId: "clingy",
        lifeStage: LifeStage.Pipling,
        activity: PipActivity.OnExpedition,
      }),
      fixtureTuning,
    );
    expect(rates.happiness).toBe(-5 * 1.3 * 1.2 * 2.0);
  });

  it("Resting flips energy to a flat +15/h, unscaled by personality or life stage", () => {
    const resting = { activity: PipActivity.Resting } as const;
    expect(effectiveRates(makePip(resting), neutralTuning).energy).toBe(15);
    // Lazy's ×1.4 and pipling's ×1.2 apply to decay only (spec §4.2
    // "multipliers on base decay") — regen is the flat tuning value.
    expect(effectiveRates(makePip({ ...resting, personalityId: "lazy" }), fixtureTuning).energy).toBe(15);
    expect(
      effectiveRates(makePip({ ...resting, lifeStage: LifeStage.Pipling }), neutralTuning)
        .energy,
    ).toBe(15);
  });

  it("other needs keep decaying while Resting (spec §4.7: decay in every state)", () => {
    const rates = effectiveRates(
      makePip({ activity: PipActivity.Resting }),
      neutralTuning,
    );
    expect(rates.hunger).toBe(-6);
    expect(rates.cleanliness).toBe(-4);
    expect(rates.happiness).toBe(-5);
  });
});

describe("applyNeedsDelta — clamping at 0 and 100", () => {
  it("clamps decay at 0 — never negative", () => {
    const pip = makePip({ needs: { ...fullNeeds(), hunger: 3 } });
    const after = applyNeedsDelta(pip, 6, neutralTuning); // −36 raw
    expect(after.needs.hunger).toBe(0);
  });

  it("stays exactly 0 on further advances", () => {
    const pip = makePip({ needs: { ...fullNeeds(), hunger: 0 } });
    const after = applyNeedsDelta(pip, 10, neutralTuning);
    expect(after.needs.hunger).toBe(0);
  });

  it("clamps Resting energy regen at 100 and holds it there", () => {
    const clock = new FakeClock();
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 95 },
      needsUpdatedAt: clock.now(),
    });
    const hours = advanceHours(clock, pip, 1 * HOUR_MS);
    const after = applyNeedsDelta(pip, hours, neutralTuning); // 95 + 15 raw
    expect(after.needs.energy).toBe(100);
    expect(applyNeedsDelta(after, 2, neutralTuning).needs.energy).toBe(100);
  });
});

describe("applyNeedsDelta — happinessIntegral accrual (spec §4.6)", () => {
  it("accrues the trapezoid area in happiness·ms while unclamped", () => {
    const clock = new FakeClock();
    const pip = makePip({
      needs: { ...fullNeeds(), happiness: 50 },
      needsUpdatedAt: clock.now(),
    });
    const hours = advanceHours(clock, pip, 4 * HOUR_MS);
    const after = applyNeedsDelta(pip, hours, neutralTuning);

    // −5/h for 4h: 50 → 30; average 40 over 4h → 160 happiness·hours.
    expect(after.needs.happiness).toBe(30);
    expect(after.happinessIntegral).toBe(160 * HOUR_MS);
    expect(after.ageMs).toBe(4 * HOUR_MS);
    // Lifetime average happiness = integral / ageMs (evolution input, §4.6).
    expect(after.happinessIntegral / after.ageMs).toBe(40);
  });

  it("is exact when happiness pins at 0 mid-interval (documented clamped-trapezoid)", () => {
    const pip = makePip({ needs: { ...fullNeeds(), happiness: 10 } });
    const after = applyNeedsDelta(pip, 4, neutralTuning);

    // −5/h from 10 hits 0 at t = 2h, then stays flat: area = (10+0)/2·2h
    // + 0·2h = 10 happiness·hours — NOT the naive endpoint trapezoid
    // (10+0)/2·4h = 20. See happinessAreaHours in needs.ts.
    expect(after.needs.happiness).toBe(0);
    expect(after.happinessIntegral).toBe(10 * HOUR_MS);
  });

  it("accrues a flat rectangle when the happiness rate is zero", () => {
    const flatHappiness: NeedsTuning = {
      ...neutralTuning,
      needDecayPerHour: { ...FIXTURE_RATES, happiness: 0 },
    };
    const pip = makePip({ needs: { ...fullNeeds(), happiness: 50 } });
    const after = applyNeedsDelta(pip, 3, flatHappiness);
    expect(after.needs.happiness).toBe(50);
    expect(after.happinessIntegral).toBe(150 * HOUR_MS);
  });

  it("integral accrual is segment-invariant while unclamped", () => {
    const start = makePip({ needs: { ...fullNeeds(), happiness: 80 } });
    const oneShot = applyNeedsDelta(start, 5.5, neutralTuning);
    const segmented = applyNeedsDelta(
      applyNeedsDelta(start, 2, neutralTuning),
      3.5,
      neutralTuning,
    );
    expect(segmented.happinessIntegral).toBe(oneShot.happinessIntegral);
    expect(segmented.ageMs).toBe(oneShot.ageMs);
  });
});

describe("accrueFrozenTime — rate-frozen catch-up segments (spec §4.5/§4.6)", () => {
  it("freezes needs but keeps ageMs and the integral accruing at the frozen value", () => {
    const clock = new FakeClock(5_000_000);
    const pip = makePip({
      needs: { hunger: 64, cleanliness: 52, happiness: 40, energy: 82 },
      ageMs: 12 * HOUR_MS,
      happinessIntegral: 700 * HOUR_MS,
      needsUpdatedAt: clock.now(),
    });
    const hours = advanceHours(clock, pip, 5 * HOUR_MS);
    const after = accrueFrozenTime(pip, hours);

    expect(after.needs).toEqual(pip.needs); // frozen
    expect(after.ageMs).toBe(17 * HOUR_MS);
    expect(after.happinessIntegral).toBe(700 * HOUR_MS + 40 * 5 * HOUR_MS);
    expect(after.needsUpdatedAt).toBe(clock.now());
  });

  it("clamps negative hours to 0", () => {
    const pip = makePip();
    const after = accrueFrozenTime(pip, -3);
    expect(after).toEqual(pip);
  });
});

/**
 * Offline catch-up tests (spec §4.5, Phase 1 gate):
 * the 12h rate cap (7-day absence = EXACTLY 12h of rate changes, bit-exact
 * against applyNeedsDelta), negative-elapsed clamp, chronological
 * segmentation (Clingy ×2.0 happiness for exactly the expedition portion),
 * cap × segment interaction, iterative Rest auto-wake, Sulking entry at
 * boundaries with pendingSulk deferral while away, events beyond the cap
 * still firing, and happinessIntegral accruing across the ENTIRE window at
 * the frozen value. Everything is driven by FakeClock; expected values
 * mirror the engine's exact float expressions so assertions are bit-exact.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, tuning } from "../../content/tuning";
import { LifeStage, PipActivity } from "./types";
import type { ActiveExpedition, PipNeeds, PipState } from "./types";
import { applyNeedsDelta } from "./needs";
import { runCatchup } from "./catchup";
import type {
  CatchupEvent,
  CatchupState,
  CatchupSummary,
  CatchupTuning,
} from "./catchup";

const SAVED_AT = 1_000 * HOUR_MS;

/**
 * FIXTURE tuning, deliberately PINNED rather than read from
 * `content/tuning.ts`.
 *
 * Everything below asserts the catch-up ENGINE — segmentation, the rate
 * cap, event ordering, integral accrual — against arithmetic a reader can
 * check in their head (100 − 6×12, a wake at (100−40)/15 = 4h). Reading
 * the live balance numbers instead would make every one of those
 * assertions re-derive itself and quietly stop pinning anything, and a
 * retune would blow up 11 engine tests that have no opinion about
 * balance. The shipped curve is owned by `core/pips/balance.test.ts`.
 *
 * These are the Phase 1 numbers the gate tests were written against.
 */
const fixture = {
  ...tuning,
  needDecayPerHour: { hunger: -6, cleanliness: -4, happiness: -5, energy: -3 },
  personalityDecayMultipliers: {
    lazy: { hunger: 0.8, cleanliness: 1.0, happiness: 1.0, energy: 1.4 },
    curious: { hunger: 1.0, cleanliness: 1.2, happiness: 0.8, energy: 1.1 },
    hardworking: { hunger: 1.2, cleanliness: 1.0, happiness: 1.1, energy: 1.2 },
    chaotic: { hunger: 1.1, cleanliness: 1.5, happiness: 0.7, energy: 1.0 },
    clingy: { hunger: 1.0, cleanliness: 1.0, happiness: 1.3, energy: 0.9 },
  },
  offlineRateCapMs: 12 * HOUR_MS,
  care: {
    ...tuning.care,
    rest: { energyPerHour: 15, autoWakeAtEnergy: 100 },
  },
  pipling: { ...tuning.pipling, durationMs: 24 * HOUR_MS, decayMultiplier: 1.2 },
} satisfies CatchupTuning;

const CAP_MS = fixture.offlineRateCapMs; // 12h in the fixture

/** Fixture tuning + an all-×1.0 "neutral" personality for exact-rate math. */
const neutralTuning = {
  ...fixture,
  personalityDecayMultipliers: {
    ...fixture.personalityDecayMultipliers,
    neutral: { hunger: 1, cleanliness: 1, happiness: 1, energy: 1 },
  },
} satisfies CatchupTuning;

const fullNeeds = (): PipNeeds => ({
  hunger: 100,
  cleanliness: 100,
  happiness: 100,
  energy: 100,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  const personalityId = overrides.personalityId ?? "neutral";
  return {
    id: "pip-1",
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
    hatchedAt: SAVED_AT - 200 * HOUR_MS,
    ageMs: 0,
    happinessIntegral: 0,
    needs: fullNeeds(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: SAVED_AT,
    ...overrides,
  };
}

const makeState = (...pips: PipState[]): CatchupState => ({ pips });

function onlyPip(state: CatchupState): PipState {
  expect(state.pips).toHaveLength(1);
  return state.pips[0]!;
}

function pipDelta(summary: CatchupSummary, pipId: string) {
  const delta = summary.pips.find((entry) => entry.pipId === pipId);
  expect(delta).toBeDefined();
  return delta!;
}

describe("the 12h rate cap (spec §4.5 rule 3, gate test a)", () => {
  it("7-day absence on an Idle neutral adult applies EXACTLY 12h of decay, bit-exact vs applyNeedsDelta(12h)", () => {
    const clock = new FakeClock(SAVED_AT);
    clock.advance(7 * 24 * HOUR_MS);
    const pip = makePip();
    const reference = applyNeedsDelta(pip, CAP_MS / HOUR_MS, neutralTuning);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    expect(after.needs.hunger).toBe(reference.needs.hunger);
    expect(after.needs.cleanliness).toBe(reference.needs.cleanliness);
    expect(after.needs.happiness).toBe(reference.needs.happiness);
    expect(after.needs.energy).toBe(reference.needs.energy);
    // Time itself is never capped: age and the clock line advance in full.
    expect(after.ageMs).toBe(7 * 24 * HOUR_MS);
    expect(after.needsUpdatedAt).toBe(SAVED_AT + 7 * 24 * HOUR_MS);
    expect(after.activity).toBe(PipActivity.Idle);

    expect(summary.elapsedMs).toBe(7 * 24 * HOUR_MS);
    expect(summary.ratedMs).toBe(CAP_MS);
    expect(summary.cappedMs).toBe(7 * 24 * HOUR_MS - CAP_MS);
    expect(summary.events).toEqual([]);
  });

  it("an absence shorter than the cap is fully rated", () => {
    const clock = new FakeClock(SAVED_AT);
    clock.advance(5 * HOUR_MS);
    const pip = makePip();
    const reference = applyNeedsDelta(pip, 5, neutralTuning);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );

    expect(onlyPip(state).needs).toEqual(reference.needs);
    expect(summary.ratedMs).toBe(5 * HOUR_MS);
    expect(summary.cappedMs).toBe(0);
  });

  it("happinessIntegral accrues for the FULL window, at the frozen value past the cap (gate test h, spec §4.6)", () => {
    const clock = new FakeClock(SAVED_AT);
    clock.advance(48 * HOUR_MS);
    const pip = makePip(); // happiness 100, −5/h neutral

    const { state } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    // Rated 12h: trapezoid from 100 down to 40 = (100+40)/2 × 12 = 840.
    // Frozen 36h at the frozen value 40 = 1440. Total 2280 happiness·hours.
    expect(after.needs.happiness).toBe(40);
    expect(after.happinessIntegral).toBe(2280 * HOUR_MS);
    expect(after.ageMs).toBe(48 * HOUR_MS);
  });
});

describe("clamped elapsed (spec §4.5, gate test b)", () => {
  it("negative elapsed (clock rolled back) changes NOTHING", () => {
    const clock = new FakeClock(SAVED_AT);
    clock.set(SAVED_AT - 3 * HOUR_MS);
    const pip = makePip({ needs: { ...fullNeeds(), hunger: 42 } });
    const input = makeState(pip);

    const { state, summary } = runCatchup(
      input,
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );

    expect(state).toBe(input); // returned untouched, not even re-normalized

    // LOAD-BEARING value-level kills, independent of the identity check
    // above: a mutant that skips the max(0, …) clamp reports NEGATIVE
    // elapsedMs/ratedMs here (feeding the "While you were away" sheet)
    // while leaving the state deep-equal — so these must stay `toBe(0)`
    // even if the identity assertion is ever relaxed to toEqual.
    expect(summary.elapsedMs).toBe(0);
    expect(summary.ratedMs).toBe(0);
    expect(summary.cappedMs).toBe(0);
    expect(summary.events).toEqual([]);
    expect(pipDelta(summary, "pip-1").needsDelta).toEqual({
      hunger: 0,
      cleanliness: 0,
      happiness: 0,
      energy: 0,
    });

    // Pip fields asserted by VALUE too (not just via the identity check):
    // needs, clock line, activity, and age must all be exactly untouched.
    const after = onlyPip(state);
    expect(after.needs.hunger).toBe(42);
    expect(after.needs).toEqual({ ...fullNeeds(), hunger: 42 });
    expect(after.needsUpdatedAt).toBe(SAVED_AT);
    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.ageMs).toBe(0);
    expect(after.happinessIntegral).toBe(0);
    const delta = pipDelta(summary, "pip-1");
    expect(delta.needsBefore).toEqual(after.needs);
    expect(delta.needsAfter).toEqual(after.needs);
  });

  it("zero elapsed changes nothing", () => {
    const clock = new FakeClock(SAVED_AT);
    const input = makeState(makePip());
    const { state, summary } = runCatchup(
      input,
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    expect(state).toBe(input);
    expect(summary.elapsedMs).toBe(0);
  });
});

describe("chronological segmentation (spec §4.5 rule 2, gate test c)", () => {
  it("Clingy ×2.0 happiness decay applies for EXACTLY the expedition portion of the absence", () => {
    // Departed 1h before save; 3h trip → returns 2h into a 6h absence.
    const trip: ActiveExpedition = {
      expeditionId: "meadow",
      departedAt: SAVED_AT - 1 * HOUR_MS,
      durationMs: 3 * HOUR_MS,
    };
    const pip = makePip({
      personalityId: "clingy",
      activity: PipActivity.OnExpedition,
      expedition: trip,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(6 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      fixture,
    );
    const after = onlyPip(state);

    // 2h at (−5 × 1.3 × 2.0) away + 4h at (−5 × 1.3) home, exactly.
    const clingy = fixture.personalityDecayMultipliers.clingy;
    const awayRate =
      fixture.needDecayPerHour.happiness *
      clingy.happiness *
      fixture.quirks.clingyExpeditionHappinessMultiplier;
    const homeRate = fixture.needDecayPerHour.happiness * clingy.happiness;
    expect(after.needs.happiness).toBe(100 + awayRate * 2 + homeRate * 4);

    // Needs without a situational modifier decay uniformly across both
    // segments (same split arithmetic, so still bit-exact).
    const energyRate = fixture.needDecayPerHour.energy * clingy.energy;
    expect(after.needs.energy).toBe(100 + energyRate * 2 + energyRate * 4);
    expect(after.needs.hunger).toBe(100 + fixture.needDecayPerHour.hunger * 6);

    // Activity ends Idle via Returning; the trip is over and unpunished.
    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.expedition).toBeNull();
    expect(after.pendingSulk).toBe(false);
    expect(summary.events).toEqual([
      {
        kind: "expeditionReturn",
        at: SAVED_AT + 2 * HOUR_MS,
        pipId: "pip-1",
        expedition: trip,
      },
    ]);
  });

  it("a Pipling crossing adultAt mid-window loses the ×1.2 multiplier from exactly that moment", () => {
    // Hatched 20h before save → adult 4h into a 10h absence.
    const pip = makePip({
      lifeStage: LifeStage.Pipling,
      hatchedAt: SAVED_AT - 20 * HOUR_MS,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(10 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    const base = fixture.needDecayPerHour.hunger;
    const piplingRate = base * 1 * fixture.pipling.decayMultiplier;
    expect(after.needs.hunger).toBe(100 + piplingRate * 4 + base * 6);
    expect(after.lifeStage).toBe(LifeStage.Adult);
    expect(summary.events).toEqual([
      { kind: "becameAdult", at: SAVED_AT + 4 * HOUR_MS, pipId: "pip-1" },
    ]);
  });
});

describe("cap × segments (spec §4.5 rules 2+3, gate test d)", () => {
  // Rates chosen so nothing clamps: base happiness −3/h, Clingy personality
  // multiplier flattened to ×1.0, quirk ×2.0 kept → away −6/h, home −3/h.
  const capSegTuning = {
    ...fixture,
    needDecayPerHour: { ...fixture.needDecayPerHour, happiness: -3 },
    personalityDecayMultipliers: {
      ...fixture.personalityDecayMultipliers,
      clingy: { ...fixture.personalityDecayMultipliers.clingy, happiness: 1.0 },
    },
  } satisfies CatchupTuning;

  it("expedition returning at hour 10 of a 20h absence: 10h away rate + 2h home rate + 0 after the 12h cap", () => {
    const trip: ActiveExpedition = {
      expeditionId: "shore",
      departedAt: SAVED_AT - 2 * HOUR_MS,
      durationMs: 12 * HOUR_MS, // returns at savedAt + 10h
    };
    const pip = makePip({
      personalityId: "clingy",
      activity: PipActivity.OnExpedition,
      expedition: trip,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(20 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      capSegTuning,
    );
    const after = onlyPip(state);

    const base = capSegTuning.needDecayPerHour.happiness; // −3
    const awayRate =
      base * 1.0 * capSegTuning.quirks.clingyExpeditionHappinessMultiplier;
    // 10h at −6, 2h at −3 (cap boundary at 12h), 8h frozen: 100−66 = 34.
    expect(after.needs.happiness).toBe(100 + awayRate * 10 + base * 2);
    expect(after.needs.happiness).toBe(34);
    expect(after.activity).toBe(PipActivity.Idle);
    expect(summary.ratedMs).toBe(12 * HOUR_MS);
    expect(summary.cappedMs).toBe(8 * HOUR_MS);
    expect(summary.events).toEqual([
      {
        kind: "expeditionReturn",
        at: SAVED_AT + 10 * HOUR_MS,
        pipId: "pip-1",
        expedition: trip,
      },
    ]);
  });
});

describe("Rest auto-wake during catch-up (spec §4.5 rule 1, gate test e)", () => {
  it("energy rises +15/h, the wake fires at the computed timestamp, decay resumes after", () => {
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 40 },
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(8 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    // Wake at (100−40)/15 = 4h; then −3/h awake for the remaining 4h.
    expect(summary.events).toEqual([
      { kind: "restAutoWake", at: SAVED_AT + 4 * HOUR_MS, pipId: "pip-1" },
    ]);
    expect(after.needs.energy).toBe(100 + fixture.needDecayPerHour.energy * 4);
    expect(after.needs.energy).toBe(88);
    expect(after.activity).toBe(PipActivity.Idle);
    // Other needs decayed through BOTH segments (Resting still decays them).
    expect(after.needs.hunger).toBe(
      100 + fixture.needDecayPerHour.hunger * 4 + fixture.needDecayPerHour.hunger * 4,
    );
  });

  // Regen slowed to +5/h so wake moments can land at or past the cap.
  const restSlowTuning = {
    ...neutralTuning,
    care: {
      ...neutralTuning.care,
      rest: { ...neutralTuning.care.rest, energyPerHour: 5 },
    },
  } satisfies CatchupTuning;

  it("a wake landing PAST the cap never fires: energy freezes below the threshold, still Resting at load", () => {
    // Deficit 95 at +5/h → would wake at 19h, past the 12h cap.
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 5 },
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(48 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      restSlowTuning,
    );
    const after = onlyPip(state);

    expect(after.activity).toBe(PipActivity.Resting);
    expect(after.needs.energy).toBe(5 + 5 * 12); // frozen at the cap value
    expect(summary.events).toEqual([]);
  });

  it("a wake landing EXACTLY at the cap fires", () => {
    // Deficit 60 at +5/h → wakes at exactly 12h = the cap boundary.
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 40 },
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(20 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      restSlowTuning,
    );
    const after = onlyPip(state);

    expect(summary.events).toEqual([
      { kind: "restAutoWake", at: SAVED_AT + 12 * HOUR_MS, pipId: "pip-1" },
    ]);
    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.needs.energy).toBe(100); // reached 100 at the cap, frozen after
  });

  it("wake events are generated ITERATIVELY: a pip that starts Resting mid-window wakes at its computable time", () => {
    const pip = makePip(); // Idle, energy 100
    const clock = new FakeClock(SAVED_AT);
    clock.advance(4 * HOUR_MS);

    // Custom event 2h in flips the pip to Resting (stand-in for a future
    // system doing so); the engine must then compute its wake itself.
    const startResting: CatchupEvent = {
      kind: "custom",
      at: SAVED_AT + 2 * HOUR_MS,
      tag: "startResting",
      pipId: "pip-1",
      apply: (s) => ({
        pips: s.pips.map((p) => ({ ...p, activity: PipActivity.Resting })),
      }),
    };

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
      [startResting],
    );
    const after = onlyPip(state);

    // Energy at +2h: 100 − 3×2 = 94 → deficit 6 at +15/h → wake 6/15 h later.
    const wakeAt = SAVED_AT + 2 * HOUR_MS + (6 / 15) * HOUR_MS;
    expect(summary.events).toEqual([
      { kind: "custom", at: SAVED_AT + 2 * HOUR_MS, tag: "startResting", pipId: "pip-1" },
      { kind: "restAutoWake", at: wakeAt, pipId: "pip-1" },
    ]);
    const hoursAwakeAfter = (SAVED_AT + 4 * HOUR_MS - wakeAt) / HOUR_MS;
    expect(after.needs.energy).toBe(
      100 + fixture.needDecayPerHour.energy * hoursAwakeAfter,
    );
    expect(after.activity).toBe(PipActivity.Idle);
  });
});

describe("Sulking at segment boundaries (spec §4.4 + §4.5 rule 5, gate test f)", () => {
  it("hunger hitting 0 at hour 3 while Idle → Sulking at the boundary", () => {
    const pip = makePip({ needs: { ...fullNeeds(), hunger: 18 } });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(5 * HOUR_MS);

    const { state } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    expect(after.needs.hunger).toBe(0); // clamped at the floor
    expect(after.activity).toBe(PipActivity.Sulking);
  });

  it("hunger hitting 0 while OnExpedition → pendingSulk, then Sulking the moment it lands (loot data intact)", () => {
    const trip: ActiveExpedition = {
      expeditionId: "forest",
      departedAt: SAVED_AT - 1 * HOUR_MS,
      durationMs: 5 * HOUR_MS, // returns at savedAt + 4h; hunger 0 at +3h
    };
    const pip = makePip({
      activity: PipActivity.OnExpedition,
      expedition: trip,
      needs: { ...fullNeeds(), hunger: 18 },
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(6 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    expect(after.activity).toBe(PipActivity.Sulking);
    expect(after.pendingSulk).toBe(false); // consumed by arriveHome
    expect(after.expedition).toBeNull();
    // The expedition completed normally — full snapshot for loot resolution.
    expect(summary.events).toEqual([
      {
        kind: "expeditionReturn",
        at: SAVED_AT + 4 * HOUR_MS,
        pipId: "pip-1",
        expedition: trip,
      },
    ]);
  });

  it("Sulking EXIT is evaluated at boundaries too: a mid-window care event releases the pip to Idle", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 10, cleanliness: 100, happiness: 100, energy: 100 },
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(3 * HOUR_MS);

    const refill: CatchupEvent = {
      kind: "custom",
      at: SAVED_AT + 1 * HOUR_MS,
      tag: "refillNeeds",
      pipId: "pip-1",
      apply: (s) => ({
        pips: s.pips.map((p) => ({
          ...p,
          needs: { hunger: 80, cleanliness: 80, happiness: 80, energy: 80 },
        })),
      }),
    };

    const { state } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
      [refill],
    );
    const after = onlyPip(state);

    // Exited Sulking at +1h (all needs ≥ 25), then decayed 2h as Idle.
    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.needs.hunger).toBe(80 + fixture.needDecayPerHour.hunger * 2);
    expect(after.needs.happiness).toBe(
      80 + fixture.needDecayPerHour.happiness * 2,
    );
  });
});

describe("events beyond the cap still fire (spec §4.5 rule 4, gate test g)", () => {
  it("expedition returning at hour 30 of a 48h absence: Idle at load, rates stopped at 12h, integral accrued for 48h", () => {
    const trip: ActiveExpedition = {
      expeditionId: "shore",
      departedAt: SAVED_AT - 2 * HOUR_MS,
      durationMs: 32 * HOUR_MS, // returns at savedAt + 30h
    };
    const pip = makePip({
      activity: PipActivity.OnExpedition,
      expedition: trip,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(48 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    // The timer is not capped: the pip is home (via Returning) at load.
    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.expedition).toBeNull();
    expect(summary.events).toEqual([
      {
        kind: "expeditionReturn",
        at: SAVED_AT + 30 * HOUR_MS,
        pipId: "pip-1",
        expedition: trip,
      },
    ]);
    // Rates contributed zero past the cap.
    expect(after.needs.hunger).toBe(100 + fixture.needDecayPerHour.hunger * 12);
    expect(after.needs.hunger).toBe(28);
    // happinessIntegral: 12h trapezoid (100→40) + 36h frozen at 40,
    // straddling the event boundary without losing a millisecond.
    expect(after.happinessIntegral).toBe(2280 * HOUR_MS);
    expect(after.ageMs).toBe(48 * HOUR_MS);
    expect(summary.ratedMs).toBe(12 * HOUR_MS);
    expect(summary.cappedMs).toBe(36 * HOUR_MS);
  });

  it("custom events beyond the cap fire too, and generic state fields pass through", () => {
    interface TestState extends CatchupState {
      readonly hatchedEggs: number;
    }
    const state: TestState = { pips: [makePip()], hatchedEggs: 0 };
    const clock = new FakeClock(SAVED_AT);
    clock.advance(48 * HOUR_MS);

    const eggDone: CatchupEvent<TestState> = {
      kind: "custom",
      at: SAVED_AT + 30 * HOUR_MS,
      tag: "eggCompletion",
      apply: (s) => ({ ...s, hatchedEggs: s.hatchedEggs + 1 }),
    };

    const result = runCatchup(state, SAVED_AT, clock.now(), neutralTuning, [
      eggDone,
    ]);

    expect(result.state.hatchedEggs).toBe(1);
    expect(result.summary.events).toEqual([
      { kind: "custom", at: SAVED_AT + 30 * HOUR_MS, tag: "eggCompletion" },
    ]);
    expect(result.state.pips[0]!.needs.hunger).toBe(28); // cap still enforced
  });
});

describe("the event seam (design: collectEvents function or event list)", () => {
  it("a collector function is called with the window bounds; out-of-window events are ignored", () => {
    const pip = makePip();
    const clock = new FakeClock(SAVED_AT);
    clock.advance(6 * HOUR_MS);
    const calls: { start: number; end: number; pipCount: number }[] = [];

    const { summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
      (state, windowStart, windowEnd) => {
        calls.push({
          start: windowStart,
          end: windowEnd,
          pipCount: state.pips.length,
        });
        return [
          { kind: "custom", at: SAVED_AT + 2 * HOUR_MS, tag: "inWindow" },
          { kind: "custom", at: SAVED_AT, tag: "atWindowStart" }, // exclusive
          { kind: "custom", at: SAVED_AT + 7 * HOUR_MS, tag: "afterLoad" },
        ];
      },
    );

    expect(calls).toEqual([
      { start: SAVED_AT, end: SAVED_AT + 6 * HOUR_MS, pipCount: 1 },
    ]);
    expect(summary.events).toEqual([
      { kind: "custom", at: SAVED_AT + 2 * HOUR_MS, tag: "inWindow" },
    ]);
  });

  it("multiple pips: events interleave chronologically and every pip gets its own delta", () => {
    const pipA = makePip({
      id: "a",
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 70 }, // wakes at +2h
    });
    const tripB: ActiveExpedition = {
      expeditionId: "meadow",
      departedAt: SAVED_AT - 1 * HOUR_MS,
      durationMs: 6 * HOUR_MS, // returns at +5h
    };
    const pipB = makePip({
      id: "b",
      activity: PipActivity.OnExpedition,
      expedition: tripB,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(8 * HOUR_MS);

    const { summary } = runCatchup(
      makeState(pipA, pipB),
      SAVED_AT,
      clock.now(),
      neutralTuning,
      [{ kind: "custom", at: SAVED_AT + 7 * HOUR_MS, tag: "gatherTick" }],
    );

    expect(summary.events.map((event) => [event.kind, event.at])).toEqual([
      ["restAutoWake", SAVED_AT + 2 * HOUR_MS],
      ["expeditionReturn", SAVED_AT + 5 * HOUR_MS],
      ["custom", SAVED_AT + 7 * HOUR_MS],
    ]);
    expect(pipDelta(summary, "a").needsDelta.hunger).toBe(
      fixture.needDecayPerHour.hunger * 8,
    );
    expect(pipDelta(summary, "b").activityAfter).toBe(PipActivity.Idle);
  });

  it("two pips returning at the same instant both fire", () => {
    const trip = (): ActiveExpedition => ({
      expeditionId: "meadow",
      departedAt: SAVED_AT - 1 * HOUR_MS,
      durationMs: 4 * HOUR_MS, // both return at +3h
    });
    const pipA = makePip({
      id: "a",
      activity: PipActivity.OnExpedition,
      expedition: trip(),
    });
    const pipB = makePip({
      id: "b",
      activity: PipActivity.OnExpedition,
      expedition: trip(),
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(4 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pipA, pipB),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );

    expect(summary.events).toHaveLength(2);
    expect(summary.events.every((e) => e.at === SAVED_AT + 3 * HOUR_MS)).toBe(
      true,
    );
    expect(state.pips.every((p) => p.activity === PipActivity.Idle)).toBe(true);
  });
});

describe("summary + hygiene", () => {
  it("per-pip deltas report before/after/delta exactly", () => {
    const pip = makePip();
    const clock = new FakeClock(SAVED_AT);
    clock.advance(2 * HOUR_MS);

    const { summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const delta = pipDelta(summary, "pip-1");

    expect(delta.activityBefore).toBe(PipActivity.Idle);
    expect(delta.activityAfter).toBe(PipActivity.Idle);
    expect(delta.needsBefore.hunger).toBe(100);
    expect(delta.needsAfter.hunger).toBe(100 + fixture.needDecayPerHour.hunger * 2);
    expect(delta.needsDelta.hunger).toBe(fixture.needDecayPerHour.hunger * 2);
    expect(summary.elapsedMs).toBe(2 * HOUR_MS);
  });

  it("never mutates the input state", () => {
    const trip: ActiveExpedition = {
      expeditionId: "meadow",
      departedAt: SAVED_AT - 1 * HOUR_MS,
      durationMs: 3 * HOUR_MS,
    };
    const pip = makePip({
      personalityId: "clingy",
      activity: PipActivity.OnExpedition,
      expedition: trip,
    });
    const input = makeState(pip);
    const snapshot = structuredClone(input);
    const clock = new FakeClock(SAVED_AT);
    clock.advance(6 * HOUR_MS);

    runCatchup(input, SAVED_AT, clock.now(), fixture);

    expect(input).toEqual(snapshot);
  });

  it("an expedition already overdue at savedAt is healed home at the start of the pass", () => {
    const trip: ActiveExpedition = {
      expeditionId: "meadow",
      departedAt: SAVED_AT - 3 * HOUR_MS,
      durationMs: 2 * HOUR_MS, // return elapsed 1h BEFORE the save
    };
    const pip = makePip({
      activity: PipActivity.OnExpedition,
      expedition: trip,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(4 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      neutralTuning,
    );
    const after = onlyPip(state);

    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.expedition).toBeNull();
    // Recorded (clamped to savedAt) so the away sheet still reports loot.
    expect(summary.events).toEqual([
      { kind: "expeditionReturn", at: SAVED_AT, pipId: "pip-1", expedition: trip },
    ]);
  });

  it("a pip saved as Returning keeps waiting for its collect (timers fire; player-gated states wait)", () => {
    const trip: ActiveExpedition = {
      expeditionId: "meadow",
      departedAt: SAVED_AT - 2 * HOUR_MS,
      durationMs: 1 * HOUR_MS,
    };
    const pip = makePip({
      personalityId: "clingy",
      activity: PipActivity.Returning,
      expedition: trip,
    });
    const clock = new FakeClock(SAVED_AT);
    clock.advance(4 * HOUR_MS);

    const { state, summary } = runCatchup(
      makeState(pip),
      SAVED_AT,
      clock.now(),
      fixture,
    );
    const after = onlyPip(state);

    expect(after.activity).toBe(PipActivity.Returning);
    expect(after.expedition).toEqual(trip);
    expect(summary.events).toEqual([]);
    // Clingy's away penalty keeps applying while Returning (spec §4.2).
    const rate =
      fixture.needDecayPerHour.happiness *
      fixture.personalityDecayMultipliers.clingy.happiness *
      fixture.quirks.clingyExpeditionHappinessMultiplier;
    expect(after.needs.happiness).toBe(100 + rate * 4);
  });
});

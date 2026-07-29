/**
 * Pip state machine tests (spec §4.4, §4.7, Phase 1 gate):
 * every legal transition, every illegal transition rejected (full matrix),
 * Sulking entry from each eligible activity, pendingSulk deferral while
 * away, the inclusive ≥ 25 exit boundary, Rest auto-wake at exactly 100,
 * and care-action legality. Time-dependent paths are driven by FakeClock
 * through applyNeedsDelta.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock";
import { HOUR_MS, tuning } from "../../content/tuning";
import { LifeStage, NEED_IDS, PipActivity } from "./types";
import type { ActiveExpedition, PipNeeds, PipState } from "./types";
import { applyNeedsDelta } from "./needs";
import {
  CARE_LEGAL_ACTIVITIES,
  arriveHome,
  assignJob,
  beginRest,
  beginReturn,
  canReceiveCare,
  departExpedition,
  evaluateRestAutoWake,
  evaluateSulk,
  restAutoWakeAt,
  unassignJob,
  wake,
  type TransitionResult,
} from "./machine";

const ALL_ACTIVITIES = Object.values(PipActivity);

const fullNeeds = (): PipNeeds => ({
  hunger: 100,
  cleanliness: 100,
  happiness: 100,
  energy: 100,
});

const meadowTrip = (departedAt = 0): ActiveExpedition => ({
  expeditionId: "meadow",
  departedAt,
  durationMs: tuning.expeditions.meadow.durationMs,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  const activity = overrides.activity ?? PipActivity.Idle;
  const away =
    activity === PipActivity.OnExpedition || activity === PipActivity.Returning;
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
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: fullNeeds(),
    activity,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    // Invariant: non-null exactly while OnExpedition/Returning.
    expedition: away ? meadowTrip() : null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function expectOk(result: TransitionResult): PipState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok transition");
  return result.pip;
}

describe("legal transitions (spec §4.7)", () => {
  it("Idle → Resting (beginRest) changes only the activity", () => {
    const pip = makePip();
    const after = expectOk(beginRest(pip));
    expect(after.activity).toBe(PipActivity.Resting);
    expect({ ...after, activity: pip.activity }).toEqual(pip);
  });

  it("Resting → Idle (wake)", () => {
    const pip = makePip({ activity: PipActivity.Resting });
    expect(expectOk(wake(pip)).activity).toBe(PipActivity.Idle);
  });

  it("Idle → AssignedJob (assignJob)", () => {
    const pip = makePip();
    expect(expectOk(assignJob(pip)).activity).toBe(PipActivity.AssignedJob);
  });

  it("AssignedJob → Idle (unassignJob)", () => {
    const pip = makePip({ activity: PipActivity.AssignedJob });
    expect(expectOk(unassignJob(pip)).activity).toBe(PipActivity.Idle);
  });

  it("Idle → OnExpedition (departExpedition) stores the expedition", () => {
    const clock = new FakeClock(1_000_000);
    const trip = meadowTrip(clock.now());
    const after = expectOk(departExpedition(makePip(), trip));
    expect(after.activity).toBe(PipActivity.OnExpedition);
    expect(after.expedition).toEqual(trip);
  });

  it("OnExpedition → Returning (beginReturn) keeps the expedition data", () => {
    const pip = makePip({ activity: PipActivity.OnExpedition });
    const after = expectOk(beginReturn(pip));
    expect(after.activity).toBe(PipActivity.Returning);
    expect(after.expedition).toEqual(pip.expedition);
  });

  it("Returning → Idle (arriveHome) clears the expedition", () => {
    const pip = makePip({ activity: PipActivity.Returning });
    const after = expectOk(arriveHome(pip));
    expect(after.activity).toBe(PipActivity.Idle);
    expect(after.expedition).toBeNull();
    expect(after.pendingSulk).toBe(false);
  });

  it("Sulking → Idle via evaluateSulk once all needs recover", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 30, cleanliness: 40, happiness: 25, energy: 90 },
    });
    expect(evaluateSulk(pip).activity).toBe(PipActivity.Idle);
  });

  it("transition functions are pure — the input pip is never mutated", () => {
    const pip = makePip();
    const snapshot = structuredClone(pip);
    beginRest(pip);
    assignJob(pip);
    departExpedition(pip, meadowTrip());
    evaluateSulk(pip);
    evaluateRestAutoWake(pip);
    expect(pip).toEqual(snapshot);
  });
});

describe("illegal transitions rejected (full matrix, typed refusals)", () => {
  // For each requested transition: the set of activities it is legal from.
  // Everything else must come back { ok: false } without throwing.
  const cases = [
    ["beginRest", (p: PipState) => beginRest(p), [PipActivity.Idle]],
    ["wake", (p: PipState) => wake(p), [PipActivity.Resting]],
    ["assignJob", (p: PipState) => assignJob(p), [PipActivity.Idle]],
    ["unassignJob", (p: PipState) => unassignJob(p), [PipActivity.AssignedJob]],
    [
      "departExpedition",
      (p: PipState) => departExpedition(p, meadowTrip()),
      [PipActivity.Idle],
    ],
    ["beginReturn", (p: PipState) => beginReturn(p), [PipActivity.OnExpedition]],
    ["arriveHome", (p: PipState) => arriveHome(p), [PipActivity.Returning]],
  ] as const;

  for (const [name, run, legalFrom] of cases) {
    for (const activity of ALL_ACTIVITIES) {
      const legal = (legalFrom as readonly PipActivity[]).includes(activity);
      it(`${name} from ${activity} is ${legal ? "legal" : "refused"}`, () => {
        const result = run(makePip({ activity }));
        expect(result.ok).toBe(legal);
        if (!result.ok) {
          expect(result.refusal.attempted).toBe(name);
          expect(result.refusal.activity).toBe(activity);
        }
      });
    }
  }

  it("Sulking Pips refuse job assignment with a 'sulking' refusal (not an exception)", () => {
    const result = assignJob(makePip({ activity: PipActivity.Sulking }));
    expect(result).toEqual({
      ok: false,
      refusal: {
        kind: "sulking",
        attempted: "assignJob",
        activity: PipActivity.Sulking,
      },
    });
  });

  it("Sulking Pips refuse expedition assignment with a 'sulking' refusal", () => {
    const result = departExpedition(
      makePip({ activity: PipActivity.Sulking }),
      meadowTrip(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.kind).toBe("sulking");
  });

  it("Piplings cannot go on expeditions — 'pipling' refusal (spec §4.6)", () => {
    const result = departExpedition(
      makePip({ lifeStage: LifeStage.Pipling }),
      meadowTrip(),
    );
    expect(result).toEqual({
      ok: false,
      refusal: {
        kind: "pipling",
        attempted: "departExpedition",
        activity: PipActivity.Idle,
      },
    });
  });

  it("Piplings CAN take jobs — only expeditions are age-gated", () => {
    const result = assignJob(makePip({ lifeStage: LifeStage.Pipling }));
    expect(result.ok).toBe(true);
  });

  it("structurally impossible moves are 'illegal', not 'sulking'", () => {
    const fromResting = assignJob(makePip({ activity: PipActivity.Resting }));
    expect(fromResting.ok).toBe(false);
    if (!fromResting.ok) expect(fromResting.refusal.kind).toBe("illegal");

    const restWhileSulking = beginRest(makePip({ activity: PipActivity.Sulking }));
    expect(restWhileSulking.ok).toBe(false);
    if (!restWhileSulking.ok) expect(restWhileSulking.refusal.kind).toBe("illegal");
  });
});

describe("Sulking entry (spec §4.4: any need hits 0)", () => {
  const eligible = [
    PipActivity.Idle,
    PipActivity.Resting,
    PipActivity.AssignedJob,
  ] as const;

  it.each(eligible)("enters Sulking from %s when a need is at 0", (activity) => {
    const pip = makePip({ activity, needs: { ...fullNeeds(), hunger: 0 } });
    const after = evaluateSulk(pip);
    expect(after.activity).toBe(PipActivity.Sulking);
    expect(after.pendingSulk).toBe(false);
  });

  it.each(NEED_IDS)("any single need at 0 triggers it — %s", (need) => {
    const pip = makePip({ needs: { ...fullNeeds(), [need]: 0 } });
    expect(evaluateSulk(pip).activity).toBe(PipActivity.Sulking);
  });

  it("a low-but-nonzero need does NOT trigger Sulking", () => {
    const pip = makePip({ needs: { ...fullNeeds(), hunger: 0.01 } });
    expect(evaluateSulk(pip).activity).toBe(PipActivity.Idle);
  });

  it("is driven to 0 by real decay under FakeClock, not just constructed", () => {
    const clock = new FakeClock(2_000_000_000);
    const pip = makePip({
      needs: { ...fullNeeds(), hunger: 3 },
      needsUpdatedAt: clock.now(),
    });
    clock.advance(6 * HOUR_MS); // curious hunger −6/h × 6h = −36 raw → clamps to 0
    const decayed = applyNeedsDelta(pip, (clock.now() - pip.needsUpdatedAt) / HOUR_MS);
    expect(decayed.needs.hunger).toBe(0);
    expect(evaluateSulk(decayed).activity).toBe(PipActivity.Sulking);
  });

  it("an already-Sulking Pip with a need at 0 just stays Sulking", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { ...fullNeeds(), happiness: 0 },
    });
    expect(evaluateSulk(pip)).toEqual(pip);
  });
});

describe("Sulking exit (spec §4.4: ALL needs ≥ 25, inclusive)", () => {
  it("exits to Idle when all four needs are EXACTLY 25", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 25, cleanliness: 25, happiness: 25, energy: 25 },
    });
    expect(evaluateSulk(pip).activity).toBe(PipActivity.Idle);
  });

  it("24.99 in a single need keeps it Sulking — the boundary is inclusive at 25", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 24.99, cleanliness: 100, happiness: 100, energy: 100 },
    });
    const after = evaluateSulk(pip);
    expect(after.activity).toBe(PipActivity.Sulking);
    expect(after).toEqual(pip);
  });

  it.each(NEED_IDS)("every need must clear the bar — %s below 25 blocks exit", (need) => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { ...fullNeeds(), [need]: 24 },
    });
    expect(evaluateSulk(pip).activity).toBe(PipActivity.Sulking);
  });

  it("threshold comes from tuning (injectable)", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 25, cleanliness: 25, happiness: 25, energy: 25 },
    });
    const stricter = { ...tuning, sulkExitThreshold: 26 };
    expect(evaluateSulk(pip, stricter).activity).toBe(PipActivity.Sulking);
  });
});

describe("pendingSulk deferral while away (spec §4.4/§4.7)", () => {
  it("need hits 0 mid-expedition → stays OnExpedition, sulks exactly on return", () => {
    const clock = new FakeClock(3_000_000_000);
    const idle = makePip({
      personalityId: "clingy",
      needs: { ...fullNeeds(), happiness: 30 },
      needsUpdatedAt: clock.now(),
    });

    // Depart: Idle → OnExpedition.
    const trip = meadowTrip(clock.now());
    let pip = expectOk(departExpedition(idle, trip));

    // 3h away: clingy happiness decays at −5 × 1.3 × 2.0 = −13/h,
    // so 30 raw-drops past 0 mid-segment and clamps there.
    clock.advance(3 * HOUR_MS);
    pip = applyNeedsDelta(pip, (clock.now() - pip.needsUpdatedAt) / HOUR_MS);
    expect(pip.needs.happiness).toBe(0);

    // Segment-boundary evaluation: activity must NOT change while away.
    pip = evaluateSulk(pip);
    expect(pip.activity).toBe(PipActivity.OnExpedition);
    expect(pip.pendingSulk).toBe(true);

    // Re-evaluation is idempotent.
    expect(evaluateSulk(pip)).toEqual(pip);

    // Still deferred through Returning.
    pip = expectOk(beginReturn(pip));
    pip = evaluateSulk(pip);
    expect(pip.activity).toBe(PipActivity.Returning);
    expect(pip.pendingSulk).toBe(true);
    expect(pip.expedition).toEqual(trip); // loot data intact — never punish the trip

    // Landing converts pendingSulk to Sulking immediately.
    pip = expectOk(arriveHome(pip));
    expect(pip.activity).toBe(PipActivity.Sulking);
    expect(pip.pendingSulk).toBe(false);
    expect(pip.expedition).toBeNull();
  });

  it("need hits 0 while Returning defers the same way", () => {
    const pip = makePip({
      activity: PipActivity.Returning,
      needs: { ...fullNeeds(), energy: 0 },
    });
    const after = evaluateSulk(pip);
    expect(after.activity).toBe(PipActivity.Returning);
    expect(after.pendingSulk).toBe(true);
  });

  it("arriveHome without pendingSulk lands in Idle, not Sulking", () => {
    const pip = makePip({ activity: PipActivity.Returning, pendingSulk: false });
    expect(expectOk(arriveHome(pip)).activity).toBe(PipActivity.Idle);
  });
});

describe("Rest auto-wake (spec §5: auto-wake at exactly 100)", () => {
  it("restAutoWakeAt is the computable (100 − energy) / 15 hours moment", () => {
    const clock = new FakeClock(7_000_000_000);
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 40 },
      needsUpdatedAt: clock.now(),
    });
    // (100 − 40) / +15 per hour = exactly 4h from the last recompute.
    expect(restAutoWakeAt(pip)).toBe(clock.now() + 4 * HOUR_MS);
  });

  it("returns null for a Pip that is not Resting", () => {
    expect(restAutoWakeAt(makePip())).toBeNull();
    expect(restAutoWakeAt(makePip({ activity: PipActivity.Sulking }))).toBeNull();
  });

  it("an already-full Resting Pip is due immediately (at needsUpdatedAt)", () => {
    const pip = makePip({
      activity: PipActivity.Resting,
      needsUpdatedAt: 123_456,
    });
    expect(restAutoWakeAt(pip)).toBe(123_456);
  });

  it("wakes at exactly 100, not beyond — FakeClock to the exact moment", () => {
    const clock = new FakeClock(9_000_000_000);
    const resting = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 40 },
      needsUpdatedAt: clock.now(),
    });
    const wakeAt = restAutoWakeAt(resting);
    expect(wakeAt).toBe(clock.now() + 4 * HOUR_MS);

    // 1ms before the computed moment: energy is still under 100 → keeps Resting.
    clock.set(wakeAt! - 1);
    const early = applyNeedsDelta(
      resting,
      (clock.now() - resting.needsUpdatedAt) / HOUR_MS,
    );
    expect(early.needs.energy).toBeLessThan(100);
    expect(evaluateRestAutoWake(early).activity).toBe(PipActivity.Resting);

    // Exactly the computed moment: energy is exactly 100 → wakes to Idle.
    clock.set(wakeAt!);
    const due = applyNeedsDelta(
      resting,
      (clock.now() - resting.needsUpdatedAt) / HOUR_MS,
    );
    expect(due.needs.energy).toBe(100); // exactly 100, not overshot
    const awake = evaluateRestAutoWake(due);
    expect(awake.activity).toBe(PipActivity.Idle);
    expect(awake.needs.energy).toBe(100);
  });

  it("evaluateRestAutoWake leaves non-Resting Pips alone even at full energy", () => {
    const pip = makePip({ needs: fullNeeds() });
    expect(evaluateRestAutoWake(pip)).toEqual(pip);
  });

  it("99.99 energy keeps Resting — the threshold is reached, not approached", () => {
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), energy: 99.99 },
    });
    expect(evaluateRestAutoWake(pip).activity).toBe(PipActivity.Resting);
  });
});

describe("care-action legality (spec §4.7: Idle, Resting, Sulking only)", () => {
  const expected: Record<PipActivity, boolean> = {
    [PipActivity.Idle]: true,
    [PipActivity.Resting]: true,
    [PipActivity.Sulking]: true,
    [PipActivity.AssignedJob]: false,
    [PipActivity.OnExpedition]: false,
    [PipActivity.Returning]: false,
  };

  it.each(ALL_ACTIVITIES)("canReceiveCare(%s)", (activity) => {
    expect(canReceiveCare(makePip({ activity }))).toBe(expected[activity]);
  });

  it("exports the legal set for the UI layer", () => {
    expect([...CARE_LEGAL_ACTIVITIES].sort()).toEqual(
      [PipActivity.Idle, PipActivity.Resting, PipActivity.Sulking].sort(),
    );
  });
});

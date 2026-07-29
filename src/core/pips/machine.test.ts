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
  isSulking,
  restAutoWakeAt,
  unassignJob,
  wake,
  type MachineTuning,
  type TransitionResult,
} from "./machine";

/**
 * FIXTURE tuning, deliberately PINNED rather than read from
 * `content/tuning.ts`: the assertions below are hand-checkable arithmetic
 * (a Clingy Pip at −5 × 1.3 × 2.0 = −13/h, a wake at (100 − 40) / 15 = 4h)
 * exercising the state MACHINE, not the shipped balance. The live curve is
 * owned by `core/pips/balance.test.ts` — a retune belongs there, not here.
 */
const fixtureNeeds = {
  needDecayPerHour: { hunger: -6, cleanliness: -4, happiness: -5, energy: -3 },
  personalityDecayMultipliers: {
    curious: { hunger: 1.0, cleanliness: 1.2, happiness: 0.8, energy: 1.1 },
    clingy: { hunger: 1.0, cleanliness: 1.0, happiness: 1.3, energy: 0.9 },
  },
  quirks: { clingyExpeditionHappinessMultiplier: 2.0 },
  pipling: { decayMultiplier: 1.2 },
  care: { rest: { energyPerHour: 15 } },
};

const fixtureMachine: MachineTuning = {
  sulkExitThreshold: tuning.sulkExitThreshold,
  care: { rest: { energyPerHour: 15, autoWakeAtEnergy: 100 } },
  // Pinned, not spread from content/tuning.ts (this file's whole
  // philosophy — see the module doc above): 8h duration, Meadow-only
  // supervised trips, matching the round 2A shape but decoupled from a
  // future retune.
  pipling: { durationMs: 8 * HOUR_MS, allowedExpeditionIds: ["meadow"] },
};

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
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: fullNeeds(),
    activity,
    pendingSulk: false,
    sulking: false,
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
    // Round 2A: beginRest is now ALSO legal from Sulking (see the
    // dedicated "Sulking → Resting" describe block below for what the
    // resulting Pip looks like).
    [
      "beginRest",
      (p: PipState) => beginRest(p),
      [PipActivity.Idle, PipActivity.Sulking],
    ],
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

  it("Piplings refuse expeditions NOT on the supervised-trip allowlist — 'pipling' refusal carrying growsUpAt (spec §4.6, round 2A amendment)", () => {
    const forestTrip: ActiveExpedition = {
      expeditionId: "forest",
      departedAt: 0,
      durationMs: 999,
    };
    const pip = makePip({ lifeStage: LifeStage.Pipling, hatchedAt: 1_000 });
    const result = departExpedition(pip, forestTrip, fixtureMachine);
    expect(result).toEqual({
      ok: false,
      refusal: {
        kind: "pipling",
        attempted: "departExpedition",
        activity: PipActivity.Idle,
        growsUpAt: pip.hatchedAt + fixtureMachine.pipling.durationMs,
      },
    });
  });

  it("Piplings CAN go on an ALLOWED expedition (tuning.pipling.allowedExpeditionIds — round 2A 'supervised short trip')", () => {
    const pip = makePip({ lifeStage: LifeStage.Pipling });
    const result = departExpedition(pip, meadowTrip(), fixtureMachine);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pip.activity).toBe(PipActivity.OnExpedition);
  });

  it("an empty allowlist reproduces the pre-round-2A blanket bar", () => {
    const noExpeditions: MachineTuning = {
      ...fixtureMachine,
      pipling: { ...fixtureMachine.pipling, allowedExpeditionIds: [] },
    };
    const result = departExpedition(
      makePip({ lifeStage: LifeStage.Pipling }),
      meadowTrip(),
      noExpeditions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.kind).toBe("pipling");
  });

  it("Piplings CAN take jobs — only expeditions are age-gated", () => {
    const result = assignJob(makePip({ lifeStage: LifeStage.Pipling }));
    expect(result.ok).toBe(true);
  });

  it("structurally impossible moves are 'illegal', not 'sulking'", () => {
    const fromResting = assignJob(makePip({ activity: PipActivity.Resting }));
    expect(fromResting.ok).toBe(false);
    if (!fromResting.ok) expect(fromResting.refusal.kind).toBe("illegal");

    // Round 2A: Rest FROM Sulking is now legal (see the dedicated
    // "Sulking → Resting" tests below) — Play/Feed/etc. from OnExpedition
    // remain the exhaustively-checked "illegal" shape instead.
    const jobWhileAway = unassignJob(
      makePip({ activity: PipActivity.OnExpedition }),
    );
    expect(jobWhileAway.ok).toBe(false);
    if (!jobWhileAway.ok) expect(jobWhileAway.refusal.kind).toBe("illegal");
  });
});

describe("Sulking entry (spec §4.4: any need hits 0)", () => {
  const eligibleForTheDisplayValue = [
    PipActivity.Idle,
    PipActivity.AssignedJob,
  ] as const;

  it.each(eligibleForTheDisplayValue)(
    "enters Sulking (the activity value) from %s when a need is at 0",
    (activity) => {
      const pip = makePip({ activity, needs: { ...fullNeeds(), hunger: 0 } });
      const after = evaluateSulk(pip);
      expect(after.activity).toBe(PipActivity.Sulking);
      expect(after.sulking).toBe(true);
      expect(after.pendingSulk).toBe(false);
    },
  );

  it("round 2A: entering while Resting sets the FLAG only — the nap is never interrupted", () => {
    // A pip already napping for unrelated reasons (Energy is fine) whose
    // Hunger separately bottoms out: the old model forced activity back
    // to Sulking here, ending the Rest early — exactly the kind of
    // punishment §4.4 rules out, and the one case the enum alone could
    // not represent (see machine.ts module doc).
    const pip = makePip({
      activity: PipActivity.Resting,
      needs: { ...fullNeeds(), hunger: 0 },
    });
    const after = evaluateSulk(pip);
    expect(after.activity).toBe(PipActivity.Resting); // still napping
    expect(after.sulking).toBe(true); // but guilt-tripping underneath
    expect(after.pendingSulk).toBe(false);
    expect(isSulking(after)).toBe(true);
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
    pip = applyNeedsDelta(
      pip,
      (clock.now() - pip.needsUpdatedAt) / HOUR_MS,
      fixtureNeeds,
    );
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
    expect(pip.sulking).toBe(true);
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
    expect(after.sulking).toBe(false); // deferred — not sulking until arrival
  });

  it("arriveHome without pendingSulk lands in Idle, not Sulking", () => {
    const pip = makePip({ activity: PipActivity.Returning, pendingSulk: false });
    const home = expectOk(arriveHome(pip));
    expect(home.activity).toBe(PipActivity.Idle);
    expect(home.sulking).toBe(false);
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
    expect(restAutoWakeAt(pip, fixtureMachine)).toBe(clock.now() + 4 * HOUR_MS);
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
    const wakeAt = restAutoWakeAt(resting, fixtureMachine);
    expect(wakeAt).toBe(clock.now() + 4 * HOUR_MS);

    // 1ms before the computed moment: energy is still under 100 → keeps Resting.
    clock.set(wakeAt! - 1);
    const early = applyNeedsDelta(
      resting,
      (clock.now() - resting.needsUpdatedAt) / HOUR_MS,
      fixtureNeeds,
    );
    expect(early.needs.energy).toBeLessThan(100);
    expect(evaluateRestAutoWake(early, fixtureMachine).activity).toBe(
      PipActivity.Resting,
    );

    // Exactly the computed moment: energy is exactly 100 → wakes to Idle.
    clock.set(wakeAt!);
    const due = applyNeedsDelta(
      resting,
      (clock.now() - resting.needsUpdatedAt) / HOUR_MS,
      fixtureNeeds,
    );
    expect(due.needs.energy).toBe(100); // exactly 100, not overshot
    const awake = evaluateRestAutoWake(due, fixtureMachine);
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

describe("Sulking → Resting → recovery (round 2A finding #2 — the soft-lock fix)", () => {
  it("beginRest from Sulking succeeds: activity → Resting, sulking flag stays true", () => {
    const pip = makePip({
      activity: PipActivity.Sulking,
      needs: { ...fullNeeds(), energy: 0 },
    });
    const after = expectOk(beginRest(pip));
    expect(after.activity).toBe(PipActivity.Resting);
    expect(after.sulking).toBe(true);
    expect(isSulking(after)).toBe(true);
    // Nothing else changed.
    expect({ ...after, activity: pip.activity, sulking: pip.sulking }).toEqual(
      pip,
    );
  });

  it("evaluateSulk right after does NOT undo the just-begun Rest — the bug this round fixes", () => {
    // Before round 2A this was the deadlock: beginRest refused outright
    // from Sulking; even patching that refusal alone would have hit this
    // very re-evaluation immediately flipping activity back to Sulking
    // (Energy is still 0 — no time has passed) because the enum could
    // not represent "napping AND still sulking" (see machine.ts doc).
    const sulking = makePip({
      activity: PipActivity.Sulking,
      needs: { ...fullNeeds(), energy: 0 },
    });
    const resting = expectOk(beginRest(sulking));
    const reevaluated = evaluateSulk(resting, fixtureMachine);
    expect(reevaluated.activity).toBe(PipActivity.Resting); // NOT bounced back
    expect(reevaluated.sulking).toBe(true); // still guilt-tripping though
  });

  it("wake() resolves to Sulking, not Idle, if the Pip is STILL sulking when the nap ends", () => {
    const pip = makePip({
      activity: PipActivity.Resting,
      sulking: true,
      needs: { hunger: 10, cleanliness: 100, happiness: 100, energy: 100 }, // hunger still floored
    });
    const after = expectOk(wake(pip));
    expect(after.activity).toBe(PipActivity.Sulking);
    expect(after.sulking).toBe(true);
  });

  it("wake() resolves to Idle when the Pip fully recovered mid-nap", () => {
    const pip = makePip({
      activity: PipActivity.Resting,
      sulking: false, // already exited via evaluateSulk before this wake
      needs: fullNeeds(),
    });
    expect(expectOk(wake(pip)).activity).toBe(PipActivity.Idle);
  });

  it("evaluateRestAutoWake mirrors wake(): Sulking if still floored, Idle otherwise", () => {
    const stillSulking = makePip({
      activity: PipActivity.Resting,
      sulking: true,
      needs: { hunger: 100, cleanliness: 5, happiness: 100, energy: 100 },
    });
    expect(evaluateRestAutoWake(stillSulking, fixtureMachine).activity).toBe(
      PipActivity.Sulking,
    );

    const recovered = makePip({
      activity: PipActivity.Resting,
      sulking: false,
      needs: fullNeeds(),
    });
    expect(evaluateRestAutoWake(recovered, fixtureMachine).activity).toBe(
      PipActivity.Idle,
    );
  });

  it("evaluateSulk exit keeps a recovering Pip Resting — recovery never cuts a nap short", () => {
    const pip = makePip({
      activity: PipActivity.Resting,
      sulking: true,
      needs: { hunger: 25, cleanliness: 25, happiness: 25, energy: 60 }, // exactly at the exit bar
    });
    const after = evaluateSulk(pip, fixtureMachine);
    expect(after.sulking).toBe(false); // exited the sulk...
    expect(after.activity).toBe(PipActivity.Resting); // ...but keeps napping
  });

  it("end-to-end under FakeClock: a Sulking Pip rests, exits Sulking at the ≥25 threshold, then auto-wakes to Idle at 100 — exactly", () => {
    const clock = new FakeClock(4_000_000_000);
    // Energy at 10 is the only need below the exit bar (the other three
    // are already fine), so with the flat 15/h regen (fixtureNeeds/
    // fixtureMachine) the exit and auto-wake moments land on exact whole
    // hours: (25 − 10) / 15 = 1h to the exit bar, (100 − 10) / 15 = 6h to
    // auto-wake. Personality multipliers do NOT apply to Rest regen
    // (needs.ts), so this is exact regardless of the curious hunger/
    // cleanliness/happiness rates still ticking underneath.
    let pip = makePip({
      activity: PipActivity.Sulking,
      needs: { hunger: 100, cleanliness: 100, happiness: 100, energy: 10 },
      needsUpdatedAt: clock.now(),
    });

    // The player's care session: toggle Rest. This is the fix — under
    // the old model `beginRest` refused outright here.
    pip = expectOk(beginRest(pip));
    expect(pip.activity).toBe(PipActivity.Resting);
    expect(pip.sulking).toBe(true);

    // 1h of napping: Energy crosses EXACTLY 25, the sulkExitThreshold.
    clock.advance(1 * HOUR_MS);
    pip = applyNeedsDelta(
      pip,
      (clock.now() - pip.needsUpdatedAt) / HOUR_MS,
      fixtureNeeds,
    );
    expect(pip.needs.energy).toBe(25);
    pip = evaluateSulk(pip, fixtureMachine);
    expect(pip.sulking).toBe(false); // exited — all four needs ≥ 25 now
    expect(pip.activity).toBe(PipActivity.Resting); // recovery never cuts the nap short
    pip = evaluateRestAutoWake(pip, fixtureMachine);
    expect(pip.activity).toBe(PipActivity.Resting); // not at 100 yet

    // 5h more (6h total from 10): Energy reaches EXACTLY 100.
    clock.advance(5 * HOUR_MS);
    pip = applyNeedsDelta(
      pip,
      (clock.now() - pip.needsUpdatedAt) / HOUR_MS,
      fixtureNeeds,
    );
    expect(pip.needs.energy).toBe(100);
    pip = evaluateSulk(pip, fixtureMachine);
    pip = evaluateRestAutoWake(pip, fixtureMachine);
    expect(pip.activity).toBe(PipActivity.Idle); // fully recovered AND awake
    expect(pip.sulking).toBe(false);
    expect(isSulking(pip)).toBe(false);
    // The other three needs decayed normally throughout (curious rates,
    // fixtureNeeds) but never threatened the exit bar.
    expect(pip.needs.hunger).toBe(
      100 +
        fixtureNeeds.needDecayPerHour.hunger *
          fixtureNeeds.personalityDecayMultipliers.curious.hunger *
          6,
    );
    expect(pip.needs.cleanliness).toBe(
      100 +
        fixtureNeeds.needDecayPerHour.cleanliness *
          fixtureNeeds.personalityDecayMultipliers.curious.cleanliness *
          6,
    );
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

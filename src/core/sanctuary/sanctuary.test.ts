/**
 * The Long Meadow (`sanctuary`) tests (docs/retention-bible.md §2, §13 test
 * plan): the one-place invariant, retire legality (including Sulking and
 * `lastPip`), arrival needs clearing the sulk via the ORDINARY §4.4 exit
 * rule, needs/age/integral frozen while resident, the `minStayMs` gate,
 * retrieve-at-cap refusing warmly, and nothing ever deleted.
 *
 * Integration-level coverage (retire → 30-simulated-day TICK/CATCHUP →
 * retrieve, through the ACTUAL reducer) lives in `core/state.test.ts` —
 * this file is unit-level, against the minimal `SanctuaryHostState` shape,
 * so it never depends on the rest of GameState.
 */

import { describe, expect, it } from "vitest";
import { LifeStage, PipActivity } from "../pips/types";
import type { PipId, PipNeeds, PipState } from "../pips/types";
import {
  buildReturnee,
  buildResident,
  createEmptySanctuary,
  retirePip,
  retireRefusal,
  retrievePip,
} from "./index";
import type { SanctuaryHostState, SanctuaryRecord } from "./index";

const ARRIVAL_NEEDS: PipNeeds = {
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 100,
};

const SULK_EXIT_THRESHOLD = 25;
const MIN_ACTIVE_PIPS = 1;

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 80, cleanliness: 80, happiness: 80, energy: 80, ...overrides };
}

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mossy",
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
    ageMs: 500_000,
    happinessIntegral: 35_000_000,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    sulking: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function makeHost(
  pips: Record<PipId, PipState>,
  overrides: Partial<Omit<SanctuaryHostState, "pips">> = {},
): SanctuaryHostState {
  const rosterOrder = Object.keys(pips);
  return {
    pips,
    rosterOrder,
    activePipId: rosterOrder[0] as PipId,
    sanctuary: createEmptySanctuary(),
    keep: { level: 1 },
    ...overrides,
  };
}

const TUNING = { minActivePips: MIN_ACTIVE_PIPS, arrivalNeeds: ARRIVAL_NEEDS };

describe("buildResident — the arrival transform (bible §2.3/§2.4)", () => {
  it("snaps needs to arrivalNeeds exactly once", () => {
    const pip = makePip({ needs: needs({ hunger: 12, cleanliness: 8 }) });
    const resident = buildResident(pip, 1000, ARRIVAL_NEEDS);
    expect(resident.needs).toEqual(ARRIVAL_NEEDS);
    expect(resident.needsUpdatedAt).toBe(1000);
  });

  it("clears a Sulking pip through the ORDINARY §4.4 exit rule, no special case", () => {
    const sulking = makePip({
      activity: PipActivity.Sulking,
      sulking: true,
      needs: needs({ hunger: 0, cleanliness: 0, happiness: 0, energy: 0 }),
    });
    const resident = buildResident(sulking, 1000, ARRIVAL_NEEDS, {
      sulkExitThreshold: SULK_EXIT_THRESHOLD,
      care: { rest: { energyPerHour: 15, autoWakeAtEnergy: 100 } },
      pipling: { durationMs: 8 * 3_600_000, allowedExpeditionIds: [] },
    });
    expect(resident.sulking).toBe(false);
    expect(resident.activity).toBe(PipActivity.Idle);
  });

  it("forces activity to Idle even from Resting or AssignedJob", () => {
    const resting = makePip({ activity: PipActivity.Resting });
    expect(buildResident(resting, 1000, ARRIVAL_NEEDS).activity).toBe(PipActivity.Idle);
    const working = makePip({ activity: PipActivity.AssignedJob });
    expect(buildResident(working, 1000, ARRIVAL_NEEDS).activity).toBe(PipActivity.Idle);
  });

  it("clears pendingSulk and expedition defensively", () => {
    const pip = makePip({ pendingSulk: true });
    const resident = buildResident(pip, 1000, ARRIVAL_NEEDS);
    expect(resident.pendingSulk).toBe(false);
    expect(resident.expedition).toBeNull();
  });

  it("never touches ageMs, happinessIntegral, genome, name, or evolved — carried over byte-for-byte", () => {
    const pip = makePip({
      ageMs: 123_456_789,
      happinessIntegral: 9_876_543,
      name: "Old Friend",
      evolved: { variantId: "verdant", evolvedAt: 500 },
      lastGiftItemId: "honeydrop",
    });
    const resident = buildResident(pip, 1000, ARRIVAL_NEEDS);
    expect(resident.ageMs).toBe(pip.ageMs);
    expect(resident.happinessIntegral).toBe(pip.happinessIntegral);
    expect(resident.genome).toEqual(pip.genome);
    expect(resident.name).toBe(pip.name);
    expect(resident.evolved).toEqual(pip.evolved);
    expect(resident.lastGiftItemId).toBe(pip.lastGiftItemId);
  });

  it("preserves readyToEvolve if already set — the sanctuary card can say 'glowing'", () => {
    const pip = makePip({ readyToEvolve: true });
    expect(buildResident(pip, 1000, ARRIVAL_NEEDS).readyToEvolve).toBe(true);
  });

  it("preserves ANY field it does not know about — a future `mastery` field survives untouched", () => {
    const withExtra = { ...makePip(), mastery: { meadow: 12 } } as PipState & {
      mastery: Record<string, number>;
    };
    const resident = buildResident(withExtra, 1000, ARRIVAL_NEEDS) as PipState & {
      mastery: Record<string, number>;
    };
    expect(resident.mastery).toEqual({ meadow: 12 });
  });
});

describe("buildReturnee — the homecoming transform (bible §2.5)", () => {
  it("returns the resident's Pip untouched except needsUpdatedAt", () => {
    const resident = buildResident(makePip(), 1000, ARRIVAL_NEEDS);
    const record: SanctuaryRecord = {
      pip: resident,
      retiredAt: 1000,
      retiredFromKeepLevel: 2,
      visits: 0,
    };
    const THIRTY_DAYS_MS = 30 * 24 * 3_600_000;
    const returnee = buildReturnee(record, 1000 + THIRTY_DAYS_MS);
    expect(returnee.needs).toEqual(ARRIVAL_NEEDS);
    expect(returnee.ageMs).toBe(resident.ageMs);
    expect(returnee.happinessIntegral).toBe(resident.happinessIntegral);
    expect(returnee.genome).toEqual(resident.genome);
    expect(returnee.name).toBe(resident.name);
    expect(returnee.activity).toBe(PipActivity.Idle);
    expect(returnee.needsUpdatedAt).toBe(1000 + THIRTY_DAYS_MS);
  });
});

describe("retirePip — legality matrix (bible §2.3)", () => {
  const legal = [
    PipActivity.Idle,
    PipActivity.Resting,
    PipActivity.Sulking,
    PipActivity.AssignedJob,
  ];
  for (const activity of legal) {
    it(`is legal from ${activity}`, () => {
      const pip = makePip({ id: "pip-1", activity });
      const other = makePip({ id: "pip-2" });
      const host = makeHost({ "pip-1": pip, "pip-2": other });
      const result = retirePip(host, "pip-1", 1000, TUNING);
      expect(result.outcome.ok).toBe(true);
    });
  }

  it("refuses OnExpedition (loot in flight, a reveal owed)", () => {
    const pip = makePip({
      id: "pip-1",
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 300_000 },
    });
    const other = makePip({ id: "pip-2" });
    const host = makeHost({ "pip-1": pip, "pip-2": other });
    const result = retirePip(host, "pip-1", 1000, TUNING);
    expect(result.outcome).toEqual({
      action: "retire",
      ok: false,
      pipId: "pip-1",
      at: 1000,
      reason: "busy",
    });
    expect(result.state).toBe(host); // untouched by reference
  });

  it("refuses Returning the same way as OnExpedition", () => {
    const pip = makePip({
      id: "pip-1",
      activity: PipActivity.Returning,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 300_000 },
    });
    const other = makePip({ id: "pip-2" });
    const host = makeHost({ "pip-1": pip, "pip-2": other });
    const result = retirePip(host, "pip-1", 1000, TUNING);
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.reason).toBe("busy");
  });

  it("refuses the last active Pip — someone has to hold the fort", () => {
    const pip = makePip({ id: "pip-1" });
    const host = makeHost({ "pip-1": pip });
    const result = retirePip(host, "pip-1", 1000, TUNING);
    expect(result.outcome).toEqual({
      action: "retire",
      ok: false,
      pipId: "pip-1",
      at: 1000,
      reason: "lastPip",
    });
  });

  it("refuses an unknown pip id structurally", () => {
    const host = makeHost({ "pip-1": makePip() });
    const result = retirePip(host, "ghost", 1000, TUNING);
    expect(result.outcome).toEqual({
      action: "retire",
      ok: false,
      pipId: "ghost",
      at: 1000,
      reason: "unknownPip",
    });
  });
});

/**
 * `retireRefusal` is the legality check split out of `retirePip` so the UI
 * can decide whether to DRAW the "Send to the Long Meadow" button
 * (`ui/focusView.ts`'s `canOfferRetire`). These tests exist to hold the
 * property that makes that split safe: the predicate and the reducer can
 * never disagree, because there is only one rule.
 */
describe("retireRefusal — the predicate the UI draws from (round 2C)", () => {
  const activities = [
    PipActivity.Idle,
    PipActivity.Resting,
    PipActivity.Sulking,
    PipActivity.AssignedJob,
    PipActivity.OnExpedition,
    PipActivity.Returning,
  ];

  it("agrees with retirePip for every activity, in both roster sizes", () => {
    for (const activity of activities) {
      for (const rosterSize of [1, 2]) {
        const pips: Record<PipId, PipState> = {
          "pip-1": makePip({
            id: "pip-1",
            activity,
            expedition:
              activity === PipActivity.OnExpedition || activity === PipActivity.Returning
                ? { expeditionId: "meadow", departedAt: 0, durationMs: 300_000 }
                : null,
          }),
        };
        if (rosterSize === 2) pips["pip-2"] = makePip({ id: "pip-2" });
        const host = makeHost(pips);

        const predicted = retireRefusal(host, "pip-1", TUNING);
        const actual = retirePip(host, "pip-1", 1000, TUNING).outcome;

        expect(
          actual.ok,
          `${activity} @ roster ${rosterSize}: predicate said ${String(predicted)}`,
        ).toBe(predicted === null);
        if (!actual.ok && actual.action === "retire") {
          expect(actual.reason).toBe(predicted);
        }
      }
    }
  });

  it("returns unknownPip for an id that is not in the roster", () => {
    const host = makeHost({ "pip-1": makePip({ id: "pip-1" }) });
    expect(retireRefusal(host, "nobody", TUNING)).toBe("unknownPip");
  });

  it("permits a Sulking Pip — a change of scene is never a punishment (bible §2.3)", () => {
    const host = makeHost({
      "pip-1": makePip({ id: "pip-1", activity: PipActivity.Sulking }),
      "pip-2": makePip({ id: "pip-2" }),
    });
    expect(retireRefusal(host, "pip-1", TUNING)).toBeNull();
  });

  it("refuses the last Pip, so the Keep is never left empty", () => {
    const host = makeHost({ "pip-1": makePip({ id: "pip-1" }) });
    expect(retireRefusal(host, "pip-1", TUNING)).toBe("lastPip");
  });
});

describe("retirePip — the one-place invariant (bible §2.6)", () => {
  it("moves the Pip WHOLESALE from pips/rosterOrder into sanctuary.pips/order", () => {
    const pip = makePip({ id: "pip-1" });
    const other = makePip({ id: "pip-2" });
    const host = makeHost({ "pip-1": pip, "pip-2": other });
    const result = retirePip(host, "pip-1", 1000, TUNING);
    const next = result.state;
    expect(next.pips["pip-1"]).toBeUndefined();
    expect(next.rosterOrder).not.toContain("pip-1");
    expect(next.sanctuary.pips["pip-1"]).toBeDefined();
    expect(next.sanctuary.order).toEqual(["pip-1"]);
    // Never both, never neither.
    const inActive = next.pips["pip-1"] !== undefined;
    const inSanctuary = next.sanctuary.pips["pip-1"] !== undefined;
    expect(inActive).toBe(false);
    expect(inSanctuary).toBe(true);
  });

  it("repoints activePipId to the first remaining roster Pip when the retiree was active", () => {
    const pip = makePip({ id: "pip-1" });
    const other = makePip({ id: "pip-2" });
    const host = makeHost(
      { "pip-1": pip, "pip-2": other },
      { activePipId: "pip-1" },
    );
    const result = retirePip(host, "pip-1", 1000, TUNING);
    expect(result.state.activePipId).toBe("pip-2");
    expect(result.state.rosterOrder).toContain(result.state.activePipId);
  });

  it("leaves activePipId untouched when a DIFFERENT pip is retired", () => {
    const pip = makePip({ id: "pip-1" });
    const other = makePip({ id: "pip-2" });
    const host = makeHost(
      { "pip-1": pip, "pip-2": other },
      { activePipId: "pip-2" },
    );
    const result = retirePip(host, "pip-1", 1000, TUNING);
    expect(result.state.activePipId).toBe("pip-2");
  });

  it("records retiredAt, retiredFromKeepLevel, and visits: 0", () => {
    const pip = makePip({ id: "pip-1" });
    const other = makePip({ id: "pip-2" });
    const host = makeHost(
      { "pip-1": pip, "pip-2": other },
      { keep: { level: 3 } },
    );
    const result = retirePip(host, "pip-1", 5000, TUNING);
    const record = result.state.sanctuary.pips["pip-1"];
    expect(record?.retiredAt).toBe(5000);
    expect(record?.retiredFromKeepLevel).toBe(3);
    expect(record?.visits).toBe(0);
  });

  it("nothing is ever deleted — the resident's PipState is a full snapshot", () => {
    const pip = makePip({ id: "pip-1", name: "Old Friend", ageMs: 999_999 });
    const other = makePip({ id: "pip-2" });
    const host = makeHost({ "pip-1": pip, "pip-2": other });
    const result = retirePip(host, "pip-1", 1000, TUNING);
    const resident = result.state.sanctuary.pips["pip-1"]?.pip;
    expect(resident?.name).toBe("Old Friend");
    expect(resident?.ageMs).toBe(999_999);
    expect(resident?.genome).toEqual(pip.genome);
  });
});

describe("retrievePip — 'Ask them home' (bible §2.5)", () => {
  function retiredHost(
    at: number,
    overrides: Partial<Omit<SanctuaryHostState, "sanctuary">> = {},
  ): SanctuaryHostState {
    const other = makePip({ id: "pip-2" });
    const base = makeHost({ "pip-2": other }, overrides);
    const retireResult = retirePip(
      makeHost({ "pip-1": makePip({ id: "pip-1" }), "pip-2": other }, overrides),
      "pip-1",
      at,
      TUNING,
    );
    return retireResult.state;
  }

  it("is free and returns the Pip to the BACK of rosterOrder, Idle", () => {
    const host = retiredHost(0);
    const result = retrievePip(host, "pip-1", 8 * 3_600_000, 3);
    expect(result.outcome.ok).toBe(true);
    expect(result.state.rosterOrder).toEqual(["pip-2", "pip-1"]);
    expect(result.state.pips["pip-1"]?.activity).toBe(PipActivity.Idle);
    expect(result.state.pips["pip-1"]?.needs).toEqual(ARRIVAL_NEEDS);
  });

  it("removes the resident from sanctuary — one-place invariant restored", () => {
    const host = retiredHost(0);
    const result = retrievePip(host, "pip-1", 8 * 3_600_000, 3);
    expect(result.state.sanctuary.pips["pip-1"]).toBeUndefined();
    expect(result.state.sanctuary.order).not.toContain("pip-1");
  });

  it("refuses before minStayMs — a settling-in period, not a countdown", () => {
    const host = retiredHost(0);
    const result = retrievePip(host, "pip-1", 4 * 3_600_000, 3, 8 * 3_600_000);
    expect(result.outcome).toEqual({
      action: "retrieve",
      ok: false,
      pipId: "pip-1",
      at: 4 * 3_600_000,
      reason: "notSettled",
    });
    expect(result.state).toBe(host);
  });

  it("succeeds exactly AT minStayMs (inclusive)", () => {
    const host = retiredHost(0);
    const result = retrievePip(host, "pip-1", 8 * 3_600_000, 3, 8 * 3_600_000);
    expect(result.outcome.ok).toBe(true);
  });

  it("refuses warmly at the roster cap — never a wall", () => {
    const other1 = makePip({ id: "pip-2" });
    const other2 = makePip({ id: "pip-3" });
    const other3 = makePip({ id: "pip-4" });
    const host: SanctuaryHostState = {
      pips: { "pip-2": other1, "pip-3": other2, "pip-4": other3 },
      rosterOrder: ["pip-2", "pip-3", "pip-4"],
      activePipId: "pip-2",
      sanctuary: {
        pips: {
          "pip-1": {
            pip: buildResident(makePip({ id: "pip-1" }), 0, ARRIVAL_NEEDS),
            retiredAt: 0,
            retiredFromKeepLevel: 1,
            visits: 0,
          },
        },
        order: ["pip-1"],
      },
      keep: { level: 1 },
    };
    const result = retrievePip(host, "pip-1", 8 * 3_600_000, 3);
    expect(result.outcome).toEqual({
      action: "retrieve",
      ok: false,
      pipId: "pip-1",
      at: 8 * 3_600_000,
      reason: "full",
    });
    expect(result.state).toBe(host);
  });

  it("refuses an unknown resident structurally", () => {
    const host = retiredHost(0);
    const result = retrievePip(host, "ghost", 8 * 3_600_000, 3);
    expect(result.outcome).toEqual({
      action: "retrieve",
      ok: false,
      pipId: "ghost",
      at: 8 * 3_600_000,
      reason: "unknownResident",
    });
  });

  it("30 simulated days resident: comes back happy and intact, byte-for-byte", () => {
    const THIRTY_DAYS_MS = 30 * 24 * 3_600_000;
    const original = makePip({
      id: "pip-1",
      name: "Old Friend",
      ageMs: 42_000,
      happinessIntegral: 3_000_000,
      genome: {
        speciesId: "mosspip",
        palette: "moss",
        pattern: "speckled",
        personalityId: "clingy",
        shiny: true,
      },
      needs: needs({ hunger: 3, cleanliness: 2, happiness: 1, energy: 0 }),
      activity: PipActivity.Sulking,
      sulking: true,
    });
    const host = makeHost({ "pip-1": original, "pip-2": makePip({ id: "pip-2" }) });
    const retired = retirePip(host, "pip-1", 0, TUNING).state;

    // Nothing calls TICK/CATCHUP here — this module never touches a
    // resident, by construction (module doc). Retrieve 30 days later:
    const result = retrievePip(retired, "pip-1", THIRTY_DAYS_MS, 3);
    expect(result.outcome.ok).toBe(true);
    const home = result.state.pips["pip-1"];
    expect(home?.name).toBe("Old Friend");
    expect(home?.genome).toEqual(original.genome);
    expect(home?.genome.shiny).toBe(true);
    expect(home?.ageMs).toBe(original.ageMs); // frozen — no accrual while resident
    expect(home?.happinessIntegral).toBe(original.happinessIntegral); // frozen
    expect(home?.needs).toEqual(ARRIVAL_NEEDS); // happy, not miserable
    expect(home?.activity).toBe(PipActivity.Idle); // cured, not still sulking
    expect(home?.sulking).toBe(false);
  });
});

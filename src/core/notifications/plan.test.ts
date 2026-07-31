import { describe, expect, it } from "vitest";
import { EggState } from "../eggs";
import type { Egg } from "../eggs";
import { nextDueAt, planNotifications } from "./plan";
import type { NotificationPipView, NotificationStateSlice } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const TUNING = {
  quietHours: { startHour: 22, endHour: 8 },
  maxPerDay: 4,
  minGapMs: 25 * MINUTE_MS,
  coalesceWindowMs: 10 * MINUTE_MS,
  maxNamesInBody: 3,
  staleAfterMs: 24 * HOUR_MS,
  permissionAsk: { afterExpeditionSends: 1, delayAfterSendMs: 3000, reAskAfterSends: 3, maxAsks: 2 },
};

function pip(id: string, name: string, expedition: NotificationPipView["expedition"]): NotificationPipView {
  return { id, name, expedition };
}

function egg(id: string, incubationStartedAt: number, incubationMs: number, state: string = EggState.Incubating): Egg {
  return {
    id,
    state: state as Egg["state"],
    foundAt: 0,
    rarity: "common",
    incubationMs,
    incubationStartedAt: state === EggState.Incubating ? incubationStartedAt : null,
    sourceExpeditionId: "meadow",
  };
}

function state(overrides: Partial<NotificationStateSlice> = {}): NotificationStateSlice {
  return {
    seed: 1234,
    rosterOrder: [],
    pips: {},
    eggs: [],
    ...overrides,
  };
}

describe("planNotifications — homecoming derivation", () => {
  it("derives a due moment directly from departedAt + durationMs, never from a stored flag", () => {
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt: 1000, durationMs: 500 }) },
    });
    const plan = planNotifications(s, TUNING);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.typeId).toBe("homecoming");
    expect(plan[0]?.dueAt).toBe(1500);
    expect(plan[0]?.subjectIds).toEqual(["p1"]);
  });

  it("a Pip not on expedition produces nothing", () => {
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", null) },
    });
    expect(planNotifications(s, TUNING)).toHaveLength(0);
  });

  it("singular title/body name the Pip and the biome, drawn from the real content registry", () => {
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt: 0, durationMs: 100 }) },
    });
    const [item] = planNotifications(s, TUNING);
    expect(item?.title).toBe("Rooter is back from Meadow");
    expect(item?.body.length).toBeGreaterThan(0);
  });

  it("coalesces three returns within coalesceWindowMs into ONE notification, firing at the LATEST dueAt", () => {
    const s = state({
      rosterOrder: ["a", "b", "c"],
      pips: {
        a: pip("a", "Rooter", { expeditionId: "meadow", departedAt: 0, durationMs: 1000 }),
        b: pip("b", "Bramble", { expeditionId: "meadow", departedAt: 0, durationMs: 1000 + 2 * MINUTE_MS }),
        c: pip("c", "Quill", { expeditionId: "meadow", departedAt: 0, durationMs: 1000 + 4 * MINUTE_MS }),
      },
    });
    const plan = planNotifications(s, TUNING);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.subjectIds).toEqual(["a", "b", "c"]);
    expect(plan[0]?.dueAt).toBe(1000 + 4 * MINUTE_MS);
    expect(plan[0]?.title).toBe("Three Pips are home");
  });

  it("does NOT coalesce two returns further apart than coalesceWindowMs", () => {
    const s = state({
      rosterOrder: ["a", "b"],
      pips: {
        a: pip("a", "Rooter", { expeditionId: "meadow", departedAt: 0, durationMs: 1000 }),
        b: pip("b", "Bramble", { expeditionId: "meadow", departedAt: 0, durationMs: 1000 + 20 * MINUTE_MS }),
      },
    });
    const plan = planNotifications(s, TUNING);
    expect(plan).toHaveLength(2);
  });
});

describe("planNotifications — pipping derivation", () => {
  it("derives a due moment from incubationStartedAt + incubationMs via eggReadyAt", () => {
    const s = state({ eggs: [egg("egg-1", 1000, 500)] });
    const plan = planNotifications(s, TUNING);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.typeId).toBe("pipping");
    expect(plan[0]?.dueAt).toBe(1500);
    expect(plan[0]?.title).toBe("An egg is pipping");
  });

  it("a Found egg (not yet incubating) produces nothing", () => {
    const s = state({ eggs: [egg("egg-1", 0, 500, EggState.Found)] });
    expect(planNotifications(s, TUNING)).toHaveLength(0);
  });

  it("a Pipping egg (already ready, waiting forever) produces nothing — eggReadyAt is null", () => {
    const s = state({ eggs: [egg("egg-1", 0, 500, EggState.Pipping)] });
    expect(planNotifications(s, TUNING)).toHaveLength(0);
  });

  it("plural title for two or more eggs pipping together", () => {
    const s = state({ eggs: [egg("egg-1", 0, 1000), egg("egg-2", 0, 1000 + MINUTE_MS)] });
    const plan = planNotifications(s, TUNING);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.title).toBe("The eggs are pipping");
  });
});

describe("nextDueAt", () => {
  it("returns the earliest NOT-YET-due moment, ignoring anything already due", () => {
    const s = state({
      rosterOrder: ["a", "b"],
      pips: {
        a: pip("a", "Rooter", { expeditionId: "meadow", departedAt: 0, durationMs: 100 }),
        b: pip("b", "Bramble", { expeditionId: "meadow", departedAt: 0, durationMs: 5000 }),
      },
    });
    // "a" is already due at 100 (past); "b" is due at 5000 (future).
    expect(nextDueAt(s, 200, TUNING)).toBe(5000);
  });

  it("returns null when nothing is outstanding", () => {
    expect(nextDueAt(state(), 0, TUNING)).toBeNull();
  });
});

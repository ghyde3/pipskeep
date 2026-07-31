import { describe, expect, it } from "vitest";
import { applyBudget, isQuietHour, localHourAt } from "./budget";
import type {
  NotificationHostTuning,
  NotificationLedger,
  NotificationPrefs,
  PlannedNotification,
} from "./types";
import { EMPTY_LEDGER } from "./types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** dayOffsetMs for dayStartHour=4 with zero timezone shift (UTC), matching
 * `core/progression/streak.test.ts`'s own convention — plain millisecond
 * math below reads as UTC clock time directly. */
const OFFSET_4AM = 4 * HOUR_MS;

const TUNING: NotificationHostTuning = {
  notifications: {
    quietHours: { startHour: 22, endHour: 8 },
    maxPerDay: 4,
    minGapMs: 25 * MINUTE_MS,
    coalesceWindowMs: 10 * MINUTE_MS,
    maxNamesInBody: 3,
    staleAfterMs: 24 * HOUR_MS,
    permissionAsk: { afterExpeditionSends: 1, delayAfterSendMs: 3000, reAskAfterSends: 3, maxAsks: 2 },
  },
  retention: { dayStartHour: 4, dayMs: DAY_MS },
};

const ALL_ON: NotificationPrefs = { master: true, types: { homecoming: true, pipping: true } };

function homecoming(dueAt: number, subjectIds: readonly string[] = ["p1"]): PlannedNotification {
  return {
    typeId: "homecoming",
    dueAt,
    subjectIds,
    title: "Rooter is back from Meadow",
    body: "Pockets full, feet muddy. Come see what they found.",
    clause: "Rooter is home from Meadow",
    tag: "pk-homecoming",
  };
}

function pipping(dueAt: number, subjectIds: readonly string[] = ["egg-1"]): PlannedNotification {
  return {
    typeId: "pipping",
    dueAt,
    subjectIds,
    title: "An egg is pipping",
    body: "Tap-tap. Tap. Something in the nursery has decided today is the day.",
    clause: "an egg is pipping",
    tag: "pk-pipping",
  };
}

/** `now` defaults to the plan's LATEST `dueAt` — i.e. "the timer fired
 * exactly on time for the last thing in the batch", the ordinary case.
 * Pass it explicitly to model a LATE wake, which is the whole point of the
 * delivery-instant accounting (see budget.ts's module doc). */
function run(
  plan: readonly PlannedNotification[],
  opts: {
    now?: number;
    ledger?: NotificationLedger;
    dayOffsetMs?: number;
    prefs?: NotificationPrefs;
    permissionGranted?: boolean;
    tuning?: NotificationHostTuning;
  } = {},
) {
  const now = opts.now ?? plan.reduce((latest, item) => Math.max(latest, item.dueAt), 0);
  return applyBudget(
    plan,
    now,
    opts.ledger ?? EMPTY_LEDGER,
    opts.dayOffsetMs ?? OFFSET_4AM,
    opts.prefs ?? ALL_ON,
    opts.permissionGranted ?? true,
    opts.tuning ?? TUNING,
  );
}

describe("localHourAt / isQuietHour", () => {
  it("localHourAt reads plain UTC clock time when dayOffsetMs encodes zero tz shift", () => {
    expect(localHourAt(22 * HOUR_MS + 30 * MINUTE_MS, OFFSET_4AM, 4)).toBe(22);
    expect(localHourAt(8 * HOUR_MS + MINUTE_MS, OFFSET_4AM, 4)).toBe(8);
  });

  it("isQuietHour handles a wraparound window (22 → 8) on both sides", () => {
    expect(isQuietHour(23, 22, 8)).toBe(true);
    expect(isQuietHour(2, 22, 8)).toBe(true);
    expect(isQuietHour(8, 22, 8)).toBe(false);
    expect(isQuietHour(21, 22, 8)).toBe(false);
    expect(isQuietHour(22, 22, 8)).toBe(true);
  });
});

describe("applyBudget — per-item suppression reasons", () => {
  it("22:30 local is dropped as quiet-hours; 08:01 local delivers", () => {
    const late = run([homecoming(22 * HOUR_MS + 30 * MINUTE_MS)]);
    expect(late.delivering).toHaveLength(0);
    expect(late.suppressed).toEqual([{ item: expect.anything(), reason: "quiet-hours" }]);

    const early = run([homecoming(8 * HOUR_MS + MINUTE_MS)]);
    expect(early.delivering).toHaveLength(1);
    expect(early.suppressed).toHaveLength(0);
  });

  it("holds across a negative-offset (UTC-) timezone too", () => {
    // dayStartHour 4, tz -5h: dayOffsetMs = 4h - 5h = -1h.
    const dayOffsetMs = -1 * HOUR_MS;
    // Local 23:00 = UTC 23:00 - (-5h) = UTC 18:00... easier: derive via
    // localHourAt directly and assert the SAME function budget.ts uses.
    const quietUtc = 3 * HOUR_MS; // some arbitrary UTC instant
    const hour = localHourAt(quietUtc, dayOffsetMs, 4);
    const result = run([homecoming(quietUtc)], { dayOffsetMs });
    if (isQuietHour(hour, 22, 8)) {
      expect(result.delivering).toHaveLength(0);
    } else {
      expect(result.delivering).toHaveLength(1);
    }
  });

  it("master off suppresses everything as master-off", () => {
    const result = run([homecoming(10 * HOUR_MS)], {
      prefs: { master: false, types: { homecoming: true, pipping: true } },
    });
    expect(result.delivering).toHaveLength(0);
    expect(result.suppressed[0]?.reason).toBe("master-off");
  });

  it("one type off suppresses only that type as type-off", () => {
    const result = run([homecoming(10 * HOUR_MS), pipping(10 * HOUR_MS + HOUR_MS)], {
      prefs: { master: true, types: { homecoming: false, pipping: true } },
    });
    const reasons = result.suppressed.map((s) => s.reason);
    expect(reasons).toContain("type-off");
    expect(result.delivering.some((d) => d.typeIds.includes("pipping"))).toBe(true);
  });

  it("permission not granted suppresses everything as no-permission", () => {
    const result = run([homecoming(10 * HOUR_MS)], { permissionGranted: false });
    expect(result.delivering).toHaveLength(0);
    expect(result.suppressed[0]?.reason).toBe("no-permission");
  });

  it("a recorded delivery replays as already-delivered", () => {
    const dueAt = 10 * HOUR_MS;
    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [{ typeId: "homecoming", subjectIds: ["p1"], dueAt, deliveredAt: dueAt }],
    };
    const result = run([homecoming(dueAt)], { ledger });
    expect(result.delivering).toHaveLength(0);
    expect(result.suppressed[0]?.reason).toBe("already-delivered");
  });
});

describe("applyBudget — volume", () => {
  it("the fifth delivery within one dayIndex is daily-cap; the next day delivers", () => {
    const base = 10 * HOUR_MS;
    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [0, 1, 2, 3].map((n) => ({
        typeId: "homecoming" as const,
        subjectIds: [`prior-${n}`],
        dueAt: base - (n + 1) * HOUR_MS,
        deliveredAt: base - (n + 1) * HOUR_MS,
      })),
    };
    const fifth = run([homecoming(base, ["p-fifth"])], { ledger });
    expect(fifth.delivering).toHaveLength(0);
    expect(fifth.suppressed[0]?.reason).toBe("daily-cap");

    const nextDay = run([homecoming(base + DAY_MS, ["p-next-day"])], { ledger });
    expect(nextDay.delivering).toHaveLength(1);
  });

  it("two items 5 minutes apart: the second is min-gap; 30 minutes apart both deliver", () => {
    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [{ typeId: "homecoming", subjectIds: ["prior"], dueAt: 10 * HOUR_MS, deliveredAt: 10 * HOUR_MS }],
    };
    const close = run([homecoming(10 * HOUR_MS + 5 * MINUTE_MS, ["p-close"])], { ledger });
    expect(close.delivering).toHaveLength(0);
    expect(close.suppressed[0]?.reason).toBe("min-gap");

    const far = run([homecoming(10 * HOUR_MS + 30 * MINUTE_MS, ["p-far"])], { ledger });
    expect(far.delivering).toHaveLength(1);
  });
});

describe("applyBudget — cross-type coalescing", () => {
  it("a homecoming and pipping within minGapMs merge into one two-clause 'The Keep has been busy'", () => {
    const result = run([homecoming(10 * HOUR_MS), pipping(10 * HOUR_MS + 4 * MINUTE_MS)]);
    expect(result.delivering).toHaveLength(1);
    const [merged] = result.delivering;
    expect(merged?.title).toBe("The Keep has been busy");
    expect(merged?.body).toContain("home");
    expect(merged?.body).toContain("pipping");
    expect(merged?.tag).toBe("pk-keep");
    expect(merged?.typeIds).toEqual(["homecoming", "pipping"]);
    // The pipping half is accounted for as a coalesced suppression, so the
    // invariant below still holds.
    expect(result.suppressed).toEqual([{ item: expect.anything(), reason: "coalesced" }]);
  });

  it("a homecoming and pipping further apart than minGapMs are not merged — each delivers at its own wake", () => {
    // Production arms ONE timer per due moment, so these two never share a
    // wake: the homecoming's own wake delivers it, and the pipping's wake
    // 40 minutes later clears the 25-minute min-gap against the ledger
    // entry the first one wrote.
    const first = run([homecoming(10 * HOUR_MS)], { now: 10 * HOUR_MS });
    expect(first.delivering).toHaveLength(1);
    expect(first.delivering[0]?.typeIds).toEqual(["homecoming"]);

    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [
        { typeId: "homecoming", subjectIds: ["p1"], dueAt: 10 * HOUR_MS, deliveredAt: 10 * HOUR_MS },
      ],
    };
    const second = run([pipping(10 * HOUR_MS + 40 * MINUTE_MS)], {
      now: 10 * HOUR_MS + 40 * MINUTE_MS,
      ledger,
    });
    expect(second.delivering).toHaveLength(1);
    expect(second.delivering[0]?.typeIds).toEqual(["pipping"]);
  });

  it("a SECOND homecoming cluster is never silently dropped when a pipping is also due", () => {
    // Round-2I review blocker. `plan.ts` emits one item per CLUSTER, so two
    // waves of Pips returning more than coalesceWindowMs apart are two
    // homecoming candidates. The merge branch used to consume the whole
    // survivor set, and cluster B vanished — not delivered, not suppressed,
    // no reason recorded anywhere.
    const base = 10 * HOUR_MS;
    const plan = [
      homecoming(base, ["A"]),
      homecoming(base + 30 * MINUTE_MS, ["B"]),
      pipping(base + 2 * MINUTE_MS, ["E1"]),
    ];
    const result = run(plan, { now: base + 30 * MINUTE_MS });

    expect(result.delivering.length + result.suppressed.length).toBe(plan.length);
    const accountedSubjects = [
      ...result.delivering.flatMap((d) => d.subjectIds),
      ...result.suppressed.flatMap((s) => s.item.subjectIds),
    ];
    expect(accountedSubjects).toContain("B");
  });
});

describe("applyBudget — the invariant", () => {
  /** Every shape the plan can actually take, INCLUDING multi-cluster ones
   * (the shape the original suite never exercised, which is how a silently
   * dropped homecoming survived). */
  const CASES: (readonly PlannedNotification[])[] = (() => {
    const base = 10 * HOUR_MS;
    return [
      [],
      [homecoming(base)],
      [homecoming(base), pipping(base + 3 * MINUTE_MS)],
      [homecoming(base), pipping(base + 40 * MINUTE_MS)],
      [homecoming(22 * HOUR_MS + 30 * MINUTE_MS), pipping(base)],
      // Multi-cluster: two homecoming waves, with and without a pipping.
      [homecoming(base, ["A"]), homecoming(base + 30 * MINUTE_MS, ["B"])],
      [homecoming(base, ["A"]), homecoming(base + 30 * MINUTE_MS, ["B"]), pipping(base + 2 * MINUTE_MS, ["E1"])],
      [
        homecoming(base, ["A"]),
        homecoming(base + 30 * MINUTE_MS, ["B"]),
        homecoming(base + 70 * MINUTE_MS, ["C"]),
        pipping(base + 2 * MINUTE_MS, ["E1"]),
        pipping(base + 90 * MINUTE_MS, ["E2"]),
      ],
    ];
  })();

  it("delivering.length + suppressed.length === plan.length, always", () => {
    for (const plan of CASES) {
      const result = run(plan);
      expect(result.delivering.length + result.suppressed.length).toBe(plan.length);
    }
  });

  it("no planned subject ever vanishes — every one is delivered or suppressed by name", () => {
    // The count alone is not enough: a dropped item plus a double-counted
    // one would still add up. This pins IDENTITY. (A cross-type merge
    // legitimately names its pipping subject twice — once in the combined
    // delivery, once in its own "coalesced" suppression — so this is
    // coverage, not a multiset equality.)
    for (const plan of CASES) {
      const result = run(plan);
      const seen = new Set([
        ...result.delivering.flatMap((d) => d.subjectIds),
        ...result.suppressed.flatMap((s) => s.item.subjectIds),
      ]);
      for (const item of plan) {
        for (const subject of item.subjectIds) {
          expect(seen.has(subject)).toBe(true);
        }
      }
    }
  });
});

describe("applyBudget — the rules are measured at the DELIVERY instant, not at dueAt", () => {
  it("a trip due at 21:30 that is only delivered at 02:00 is quiet-hours, not a 2am buzz", () => {
    const dueAt = 21 * HOUR_MS + 30 * MINUTE_MS; // outside the 22→8 window
    // On time: it delivers.
    expect(run([homecoming(dueAt)], { now: dueAt }).delivering).toHaveLength(1);

    // The lid was closed at 21:05 and opened at 02:00 (suspended timers
    // fire on resume). Same item, same plan — now it must stay silent.
    const late = run([homecoming(dueAt)], { now: 26 * HOUR_MS }); // 02:00 next day
    expect(late.delivering).toHaveLength(0);
    expect(late.suppressed[0]?.reason).toBe("quiet-hours");
  });

  it("a due moment inside quiet hours delivers once the morning arrives", () => {
    // The mirror image: the rule is about when the phone lights up, so a
    // 02:00 return picked up at 09:00 is a perfectly ordinary notification.
    const dueAt = 26 * HOUR_MS; // 02:00
    expect(run([homecoming(dueAt)], { now: dueAt }).delivering).toHaveLength(0);
    expect(run([homecoming(dueAt)], { now: 33 * HOUR_MS }).delivering).toHaveLength(1);
  });

  it("two items due 30 minutes apart but discovered in ONE late wake buzz once, not twice", () => {
    const base = 10 * HOUR_MS;
    const result = run([homecoming(base, ["A"]), homecoming(base + 30 * MINUTE_MS, ["B"])], {
      now: base + 3 * HOUR_MS,
    });
    expect(result.delivering).toHaveLength(1);
    expect(result.suppressed.map((s) => s.reason)).toEqual(["min-gap"]);
    // The earlier one wins the slot — chronological order, not arrival order.
    expect(result.delivering[0]?.subjectIds).toEqual(["A"]);
  });
});

describe("applyBudget — the boundaries themselves", () => {
  it("exactly minGapMs after the last delivery is allowed; one millisecond less is not", () => {
    const priorAt = 10 * HOUR_MS;
    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [{ typeId: "homecoming", subjectIds: ["prior"], dueAt: priorAt, deliveredAt: priorAt }],
    };
    const atGap = run([homecoming(priorAt + 25 * MINUTE_MS, ["p"])], {
      now: priorAt + 25 * MINUTE_MS,
      ledger,
    });
    expect(atGap.delivering).toHaveLength(1);

    const justUnder = run([homecoming(priorAt + 25 * MINUTE_MS - 1, ["p"])], {
      now: priorAt + 25 * MINUTE_MS - 1,
      ledger,
    });
    expect(justUnder.delivering).toHaveLength(0);
    expect(justUnder.suppressed[0]?.reason).toBe("min-gap");
  });

  it("the cap's allow-side: the fourth delivery of the day still goes out", () => {
    const base = 10 * HOUR_MS;
    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [0, 1, 2].map((n) => ({
        typeId: "homecoming" as const,
        subjectIds: [`prior-${n}`],
        dueAt: base - (n + 1) * HOUR_MS,
        deliveredAt: base - (n + 1) * HOUR_MS,
      })),
    };
    const fourth = run([homecoming(base, ["p-fourth"])], { ledger });
    expect(fourth.delivering).toHaveLength(1);
  });
});

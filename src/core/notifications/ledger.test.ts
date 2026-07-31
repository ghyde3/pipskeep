import { describe, expect, it } from "vitest";
import {
  alreadyDelivered,
  deliveredCountForDay,
  lastDeliveryAt,
  pruneLedgerToDay,
  recordDelivery,
} from "./ledger";
import { EMPTY_LEDGER } from "./types";
import type { DueNotification, NotificationLedger } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayIndexOf = (at: number): number => Math.floor(at / DAY_MS);

function due(dueAt: number, subjectIds: readonly string[] = ["p1"]): DueNotification {
  return {
    typeIds: ["homecoming"],
    subjectIds,
    dueAt,
    title: "t",
    body: "b",
    tag: "pk-homecoming",
  };
}

describe("recordDelivery / alreadyDelivered", () => {
  it("a fresh ledger has never delivered anything", () => {
    expect(alreadyDelivered(EMPTY_LEDGER, "homecoming", ["p1"], 100)).toBe(false);
  });

  it("recordDelivery makes an exact-match lookup come back true", () => {
    const ledger = recordDelivery(EMPTY_LEDGER, due(100), 105, dayIndexOf(105), dayIndexOf);
    expect(alreadyDelivered(ledger, "homecoming", ["p1"], 100)).toBe(true);
    expect(alreadyDelivered(ledger, "homecoming", ["p1"], 101)).toBe(false); // different dueAt
    expect(alreadyDelivered(ledger, "pipping", ["p1"], 100)).toBe(false); // different type
  });

  it("subject-set membership is order-independent", () => {
    const ledger = recordDelivery(EMPTY_LEDGER, due(100, ["a", "b"]), 100, dayIndexOf(100), dayIndexOf);
    expect(alreadyDelivered(ledger, "homecoming", ["b", "a"], 100)).toBe(true);
  });

  it("a cross-type merge writes one entry per constituent type", () => {
    const merged: DueNotification = {
      typeIds: ["homecoming", "pipping"],
      subjectIds: ["p1", "egg-1"],
      dueAt: 100,
      title: "t",
      body: "b",
      tag: "pk-keep",
    };
    const ledger = recordDelivery(EMPTY_LEDGER, merged, 100, dayIndexOf(100), dayIndexOf);
    expect(alreadyDelivered(ledger, "homecoming", ["p1", "egg-1"], 100)).toBe(true);
    expect(alreadyDelivered(ledger, "pipping", ["p1", "egg-1"], 100)).toBe(true);
  });
});

describe("deliveredCountForDay / lastDeliveryAt", () => {
  it("counts only entries in the given day bucket", () => {
    let ledger: NotificationLedger = EMPTY_LEDGER;
    ledger = recordDelivery(ledger, due(1 * DAY_MS + 1), 1 * DAY_MS + 1, dayIndexOf(1 * DAY_MS + 1), dayIndexOf);
    ledger = recordDelivery(ledger, due(1 * DAY_MS + 2, ["p2"]), 1 * DAY_MS + 2, dayIndexOf(1 * DAY_MS + 2), dayIndexOf);
    ledger = recordDelivery(ledger, due(2 * DAY_MS + 1, ["p3"]), 2 * DAY_MS + 1, dayIndexOf(2 * DAY_MS + 1), dayIndexOf);
    expect(deliveredCountForDay(ledger, 1, dayIndexOf)).toBe(2);
    expect(deliveredCountForDay(ledger, 2, dayIndexOf)).toBe(1);
    expect(deliveredCountForDay(ledger, 0, dayIndexOf)).toBe(0);
  });

  it("lastDeliveryAt is the max deliveredAt, or null when empty", () => {
    expect(lastDeliveryAt(EMPTY_LEDGER)).toBeNull();
    let ledger: NotificationLedger = EMPTY_LEDGER;
    ledger = recordDelivery(ledger, due(10), 10, dayIndexOf(10), dayIndexOf);
    ledger = recordDelivery(ledger, due(50, ["p2"]), 50, dayIndexOf(50), dayIndexOf);
    expect(lastDeliveryAt(ledger)).toBe(50);
  });
});

describe("pruneLedgerToDay", () => {
  it("keeps only entries from day and day - 1, dropping anything older", () => {
    let ledger: NotificationLedger = EMPTY_LEDGER;
    ledger = recordDelivery(ledger, due(0), 0, 0, dayIndexOf); // day 0
    ledger = recordDelivery(ledger, due(1 * DAY_MS, ["p2"]), 1 * DAY_MS, 1, dayIndexOf); // day 1
    ledger = recordDelivery(ledger, due(5 * DAY_MS, ["p3"]), 5 * DAY_MS, 5, dayIndexOf); // day 5

    const pruned = pruneLedgerToDay(ledger, 5, dayIndexOf);
    expect(pruned.deliveries.map((e) => e.subjectIds[0])).toEqual(["p3"]);
  });

  it("is a no-op when the ledger is already tagged the given day", () => {
    const ledger: NotificationLedger = { day: 3, deliveries: [] };
    expect(pruneLedgerToDay(ledger, 3, dayIndexOf)).toBe(ledger);
  });

  it("recordDelivery itself prunes as part of appending", () => {
    let ledger: NotificationLedger = EMPTY_LEDGER;
    ledger = recordDelivery(ledger, due(0), 0, 0, dayIndexOf);
    ledger = recordDelivery(ledger, due(10 * DAY_MS, ["p2"]), 10 * DAY_MS, 10, dayIndexOf);
    expect(ledger.deliveries).toHaveLength(1);
    expect(ledger.deliveries[0]?.subjectIds).toEqual(["p2"]);
  });
});

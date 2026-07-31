/**
 * `dueNotifications` — the round's testability keystone (docs/
 * notifications-bible.md's whole architecture, condensed into one pure
 * function). Exercises the full pipe: derivation (plan.ts) → the
 * annoyance budget (budget.ts) → what should exist right now.
 */

import { describe, expect, it } from "vitest";
import { tuning } from "../../content/tuning";
import { EggState } from "../eggs";
import type { Egg } from "../eggs";
import { dueNotifications } from "./index";
import { EMPTY_LEDGER } from "./types";
import type {
  NotificationLedger,
  NotificationPipView,
  NotificationPrefs,
  NotificationStateSlice,
} from "./types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const OFFSET_4AM = 4 * HOUR_MS; // dayStartHour 4, zero tz shift

const ALL_ON: NotificationPrefs = { master: true, types: { homecoming: true, pipping: true } };

function pip(id: string, name: string, expedition: NotificationPipView["expedition"]): NotificationPipView {
  return { id, name, expedition };
}

function egg(id: string, incubationStartedAt: number, incubationMs: number): Egg {
  return {
    id,
    state: EggState.Incubating,
    foundAt: 0,
    rarity: "common",
    incubationMs,
    incubationStartedAt,
    sourceExpeditionId: "meadow",
  };
}

function state(overrides: Partial<NotificationStateSlice> = {}): NotificationStateSlice {
  return { seed: 99, rosterOrder: [], pips: {}, eggs: [], ...overrides };
}

describe("dueNotifications — the keystone", () => {
  it("returns nothing before a due moment, and the notification once now passes it", () => {
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt: 10 * HOUR_MS, durationMs: 5 * MINUTE_MS }) },
    });
    const settings = { prefs: ALL_ON, ledger: EMPTY_LEDGER, dayOffsetMs: OFFSET_4AM, permissionGranted: true };

    expect(dueNotifications(s, 10 * HOUR_MS + 4 * MINUTE_MS, settings)).toHaveLength(0);
    const due = dueNotifications(s, 10 * HOUR_MS + 5 * MINUTE_MS, settings);
    expect(due).toHaveLength(1);
    expect(due[0]?.typeIds).toEqual(["homecoming"]);
  });

  it("cancellation IS recompute: once the Pip is no longer on expedition in `state`, nothing is due", () => {
    // Simulates "the player already handled it" — by the time the real
    // TICK/CATCHUP settled the return, the Pip is no longer OnExpedition,
    // so a later recompute over the NEW state derives nothing at all.
    const departedAt = 10 * HOUR_MS;
    const traveling = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 100 }) },
    });
    const settled = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", null) },
    });
    const settings = { prefs: ALL_ON, ledger: EMPTY_LEDGER, dayOffsetMs: OFFSET_4AM, permissionGranted: true };
    const now = departedAt + 1000;

    expect(dueNotifications(traveling, now, settings)).toHaveLength(1);
    expect(dueNotifications(settled, now, settings)).toHaveLength(0);
  });

  it("permission-denied never throws and simply delivers nothing — the game stays fully functional", () => {
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 100 }) },
      eggs: [egg("egg-1", departedAt, 50)],
    });
    const now = departedAt + 1000;

    // Control: with permission granted, the SAME state/now DOES deliver —
    // proving the emptiness below is specifically about permission, not
    // quiet hours or anything else.
    expect(
      dueNotifications(s, now, { prefs: ALL_ON, ledger: EMPTY_LEDGER, dayOffsetMs: OFFSET_4AM, permissionGranted: true }),
    ).not.toHaveLength(0);

    expect(() =>
      dueNotifications(s, now, {
        prefs: ALL_ON,
        ledger: EMPTY_LEDGER,
        dayOffsetMs: OFFSET_4AM,
        permissionGranted: false,
      }),
    ).not.toThrow();
    expect(
      dueNotifications(s, now, {
        prefs: ALL_ON,
        ledger: EMPTY_LEDGER,
        dayOffsetMs: OFFSET_4AM,
        permissionGranted: false,
      }),
    ).toHaveLength(0);
  });

  it("three simultaneous returns coalesce into exactly one delivered notification", () => {
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["a", "b", "c"],
      pips: {
        a: pip("a", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 1000 }),
        b: pip("b", "Bramble", { expeditionId: "meadow", departedAt, durationMs: 1000 + MINUTE_MS }),
        c: pip("c", "Quill", { expeditionId: "meadow", departedAt, durationMs: 1000 + 2 * MINUTE_MS }),
      },
    });
    const due = dueNotifications(s, departedAt + HOUR_MS, {
      prefs: ALL_ON,
      ledger: EMPTY_LEDGER,
      dayOffsetMs: OFFSET_4AM,
      permissionGranted: true,
    });
    expect(due).toHaveLength(1);
    expect(due[0]?.subjectIds).toEqual(["a", "b", "c"]);
  });

  it("a due moment older than staleAfterMs is not announced at all", () => {
    // ROUND-2I REVIEW FIX (minor, compounding): `dueAt <= now` had no
    // lower bound, so a machine asleep for three days woke and buzzed
    // about Tuesday's Meadow trip. The copy survives it (no time words, by
    // design) but the interruption does not deserve to exist.
    const departedAt = 10 * HOUR_MS;
    const dueAt = departedAt + 100;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 100 }) },
    });
    const settings = { prefs: ALL_ON, ledger: EMPTY_LEDGER, dayOffsetMs: OFFSET_4AM, permissionGranted: true };
    const horizon = tuning.notifications.staleAfterMs;

    // Just inside the horizon (and outside quiet hours): still worth saying.
    expect(dueNotifications(s, dueAt + horizon - 2 * HOUR_MS, settings)).toHaveLength(1);
    // Past it: silence.
    expect(dueNotifications(s, dueAt + horizon + 1, settings)).toHaveLength(0);
    expect(dueNotifications(s, dueAt + 3 * 24 * HOUR_MS, settings)).toHaveLength(0);
  });

  it("an item already recorded in the ledger does not redeliver", () => {
    const dueAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt: 0, durationMs: dueAt }) },
    });
    const ledger: NotificationLedger = {
      day: 0,
      deliveries: [{ typeId: "homecoming", subjectIds: ["p1"], dueAt, deliveredAt: dueAt }],
    };

    // Control: with an EMPTY ledger the exact same item DOES deliver.
    expect(
      dueNotifications(s, dueAt + 1000, {
        prefs: ALL_ON,
        ledger: EMPTY_LEDGER,
        dayOffsetMs: OFFSET_4AM,
        permissionGranted: true,
      }),
    ).toHaveLength(1);

    expect(
      dueNotifications(s, dueAt + 1000, { prefs: ALL_ON, ledger, dayOffsetMs: OFFSET_4AM, permissionGranted: true }),
    ).toHaveLength(0);
  });
});

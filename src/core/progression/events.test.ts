import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import { EVENTS } from "../../content/events";
import type { EventDef } from "../../content/events";
import {
  activeEventEggChanceBonusPoints,
  activeEventLootBonusChance,
  eventAdjustedPityThreshold,
  isWindowActive,
  resolveActiveEvents,
} from "./events";

describe("isWindowActive — pure month-day math, no Date", () => {
  it("matches inside an ordinary (non-wrapping) window, inclusive on both ends", () => {
    const window = { from: "06-01", to: "06-07" };
    expect(isWindowActive(window, { month: 6, day: 1 })).toBe(true);
    expect(isWindowActive(window, { month: 6, day: 7 })).toBe(true);
    expect(isWindowActive(window, { month: 6, day: 4 })).toBe(true);
    expect(isWindowActive(window, { month: 5, day: 31 })).toBe(false);
    expect(isWindowActive(window, { month: 6, day: 8 })).toBe(false);
  });

  it("handles a window that wraps the new year", () => {
    const window = { from: "12-28", to: "01-03" };
    expect(isWindowActive(window, { month: 12, day: 30 })).toBe(true);
    expect(isWindowActive(window, { month: 1, day: 2 })).toBe(true);
    expect(isWindowActive(window, { month: 6, day: 15 })).toBe(false);
  });

  it("recurs annually — the SAME month-day is active every year (the whole point, bible §8.1)", () => {
    const window = { from: "12-15", to: "12-24" };
    // "This year" and "next year" are the same MonthDay — the function
    // has no concept of year at all, so recurrence is automatic.
    expect(isWindowActive(window, { month: 12, day: 20 })).toBe(true);
  });
});

describe("resolveActiveEvents", () => {
  it("finds the real Lantern Nights window active in mid-December", () => {
    const active = resolveActiveEvents({ month: 12, day: 20 });
    expect(active).toContain("lantern-nights");
  });

  it("finds nothing active on an ordinary spring day outside any window", () => {
    const active = resolveActiveEvents({ month: 4, day: 15 });
    expect(active).toEqual([]);
  });
});

describe("activeEventLootBonusChance / activeEventEggChanceBonusPoints", () => {
  it("is 0 with no active events", () => {
    expect(activeEventLootBonusChance([], contentTuning)).toBe(0);
    expect(activeEventEggChanceBonusPoints([], "lanterngrotto")).toBe(0);
  });

  it("sums a real event's contribution, capped per-event at lootBonusRollChanceMax", () => {
    const chance = activeEventLootBonusChance(["berry-glut"], contentTuning);
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThanOrEqual(contentTuning.retention.events.lootBonusRollChanceMax);
  });

  it("egg-chance bonus points only apply to the named expedition", () => {
    const grotto = activeEventEggChanceBonusPoints(["lantern-nights"], "lanterngrotto");
    const meadow = activeEventEggChanceBonusPoints(["lantern-nights"], "meadow");
    expect(grotto).toBeGreaterThan(0);
    expect(meadow).toBe(0);
  });

  it("an unknown/inactive event id contributes nothing", () => {
    expect(activeEventLootBonusChance(["not-a-real-event"], contentTuning)).toBe(0);
  });
});

describe("eventAdjustedPityThreshold — may only LOWER, floored, never invents a chase", () => {
  it("lowers the threshold during Lantern Nights, floored at pityThresholdMin", () => {
    const adjusted = eventAdjustedPityThreshold(6, "lanterngrotto", ["lantern-nights"], contentTuning);
    expect(adjusted).toBe(4);
    expect(adjusted).toBeGreaterThanOrEqual(contentTuning.retention.events.pityThresholdMin);
  });

  it("never RAISES a threshold even if a hostile override tried to", () => {
    const hostileEvents: readonly EventDef[] = [
      {
        id: "hostile",
        name: "Hostile",
        blurb: "",
        window: { from: "01-01", to: "12-31" },
        pityThresholdOverride: { meadow: 999 },
      },
    ];
    const adjusted = eventAdjustedPityThreshold(8, "meadow", ["hostile"], contentTuning, hostileEvents);
    expect(adjusted).toBeLessThanOrEqual(8); // never worse than the base
  });

  it("never invents a chase for a no-pity pool (null stays null)", () => {
    const adjusted = eventAdjustedPityThreshold(null, "bramblewick", ["lantern-nights"], contentTuning);
    expect(adjusted).toBeNull();
  });

  it("outside the window, no override applies", () => {
    const adjusted = eventAdjustedPityThreshold(6, "lanterngrotto", [], contentTuning);
    expect(adjusted).toBe(6);
  });
});

describe("EVENTS registry — nothing exclusive, everything obtainable year-round", () => {
  it("every event recurs annually (month-day windows, never a fixed year)", () => {
    for (const e of EVENTS) {
      expect(e.window.from).toMatch(/^\d{2}-\d{2}$/);
      expect(e.window.to).toMatch(/^\d{2}-\d{2}$/);
    }
  });

  it("featured items/decorations are ids that exist in the real registries — obtainable all year, never exclusive", () => {
    // Imported lazily to avoid a hard dependency cycle at module scope.
    // (content/foods.ts and content/decorations.ts import nothing from
    // content/events.ts, so this is a one-way check.)
    return import("../../content/foods").then(({ foods }) => {
      return import("../../content/decorations").then(({ decorations }) => {
        const decorationIds = new Set(decorations.map((d) => d.id));
        for (const e of EVENTS) {
          for (const itemId of e.featuredItemIds ?? []) {
            expect(foods[itemId as keyof typeof foods], `${e.id} features unknown food ${itemId}`).toBeDefined();
          }
          for (const decoId of e.featuredDecorationIds ?? []) {
            expect(decorationIds.has(decoId), `${e.id} features unknown decoration ${decoId}`).toBe(true);
          }
        }
      });
    });
  });

  it("pity overrides never exceed the base thresholds the bible published (only ever a discount)", () => {
    for (const e of EVENTS) {
      for (const [expeditionId, override] of Object.entries(e.pityThresholdOverride ?? {})) {
        const baseThreshold =
          contentTuning.retention.eggPity.thresholdByRarity["uncommon"] ??
          contentTuning.retention.eggPity.thresholdByRarity["rare"];
        expect(override, `${e.id} / ${expeditionId}`).toBeLessThanOrEqual(baseThreshold ?? Infinity);
        expect(override).toBeGreaterThanOrEqual(contentTuning.retention.events.pityThresholdMin);
      }
    }
  });

  it("loot bonus chances stay within the per-event cap", () => {
    for (const e of EVENTS) {
      if (e.lootBonusRollChance !== undefined) {
        expect(e.lootBonusRollChance).toBeLessThanOrEqual(
          contentTuning.retention.events.lootBonusRollChanceMax,
        );
      }
    }
  });
});

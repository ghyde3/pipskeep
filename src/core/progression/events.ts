/**
 * EVENTS — the core-side half (docs/retention-bible.md §8.3): resolving
 * WHICH events are active, and reading their (already-clamped) effects.
 * Date-free: everything here takes a `MonthDay` (`core/clock.ts`'s
 * `monthDayFromMs`) as plain data — the app layer owns `Date` and
 * dispatches `SET_ACTIVE_EVENTS` with the resolved id list at boot and on
 * `visibilitychange` (spec §2 rule 2: core never asks what day it is).
 *
 * A stale `activeEvents` list in a save can only ever have GRANTED a
 * bonus, never taken one — every function below is additive, and an
 * event whose window has closed simply stops matching on the next
 * resolve. Worst case of a missed refresh is a few extra items, never a
 * missing one (bible §8.3).
 */

import type { MonthDay } from "../clock";
import { EVENTS as contentEvents } from "../../content/events";
import type { EventDef, EventWindow } from "../../content/events";

export type { EventDef, EventWindow };

/** Cumulative day-of-year at the START of each month (non-leap; a ±1 day
 * wobble around Feb 29 is immaterial for week-long seasonal windows). */
const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function ordinal(month: number, day: number): number {
  const m = Math.min(Math.max(Math.trunc(month), 1), 12);
  return (CUMULATIVE_DAYS[m - 1] as number) + day;
}

function parseWindow(window: EventWindow): { from: number; to: number } {
  const [fromMonth, fromDay] = window.from.split("-").map(Number);
  const [toMonth, toDay] = window.to.split("-").map(Number);
  return {
    from: ordinal(fromMonth ?? 1, fromDay ?? 1),
    to: ordinal(toMonth ?? 1, toDay ?? 1),
  };
}

/**
 * Is `monthDay` inside `window` (inclusive)? Handles a window that wraps
 * the new year (e.g. "12-28" to "01-03") by treating `from > to` as
 * wrapping. Pure integer math — no Date.
 */
export function isWindowActive(window: EventWindow, monthDay: MonthDay): boolean {
  const { from, to } = parseWindow(window);
  const at = ordinal(monthDay.month, monthDay.day);
  if (from <= to) return at >= from && at <= to;
  return at >= from || at <= to; // wraps across the year boundary
}

/** Every event whose window is active on `monthDay`, from the registry
 * (defaults to the real content). Order follows registry order. */
export function resolveActiveEvents(
  monthDay: MonthDay,
  registry: readonly EventDef[] = contentEvents,
): readonly string[] {
  return registry.filter((e) => isWindowActive(e.window, monthDay)).map((e) => e.id);
}

/** The slice of tuning event effects are clamped against (bible §8.4). */
export interface EventTuning {
  readonly retention: {
    readonly events: {
      readonly lootBonusRollChanceMax: number;
      readonly pityThresholdMin: number;
    };
  };
}

/** Summed (not yet globally clamped — `multipliers.ts` does the final
 * cross-source clamp) loot-bonus chance from every currently-active
 * event, each individually capped at `lootBonusRollChanceMax`. */
export function activeEventLootBonusChance(
  activeEventIds: readonly string[],
  tuning: EventTuning,
  registry: readonly EventDef[] = contentEvents,
): number {
  let sum = 0;
  for (const id of activeEventIds) {
    const def = registry.find((e) => e.id === id);
    if (def?.lootBonusRollChance === undefined) continue;
    sum += Math.min(def.lootBonusRollChance, tuning.retention.events.lootBonusRollChanceMax);
  }
  return sum;
}

/** Summed egg-chance bonus POINTS an active set of events contributes to
 * one specific expedition (before `multipliers.ts`'s global clamp). */
export function activeEventEggChanceBonusPoints(
  activeEventIds: readonly string[],
  expeditionId: string,
  registry: readonly EventDef[] = contentEvents,
): number {
  let sum = 0;
  for (const id of activeEventIds) {
    const def = registry.find((e) => e.id === id);
    const points = def?.eggChanceBonusPoints?.[expeditionId];
    if (points !== undefined) sum += points;
  }
  return sum;
}

/**
 * The pity threshold for a biome, after any active event override — an
 * override may only LOWER the threshold, floored at `pityThresholdMin`
 * (an event that made a chase LONGER would be a punishment for playing at
 * the wrong time of year — forbidden by construction here, not just by
 * convention). `baseThreshold === null` (a no-pity pool) is NEVER
 * overridden — an event cannot invent a chase where the base design has
 * none.
 */
export function eventAdjustedPityThreshold(
  baseThreshold: number | null,
  expeditionId: string,
  activeEventIds: readonly string[],
  tuning: EventTuning,
  registry: readonly EventDef[] = contentEvents,
): number | null {
  if (baseThreshold === null) return null;
  let threshold = baseThreshold;
  for (const id of activeEventIds) {
    const def = registry.find((e) => e.id === id);
    const override = def?.pityThresholdOverride?.[expeditionId];
    if (override === undefined) continue;
    const floored = Math.max(override, tuning.retention.events.pityThresholdMin);
    threshold = Math.min(threshold, floored);
  }
  return threshold;
}

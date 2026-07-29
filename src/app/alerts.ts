/**
 * In-app alert derivation (spec §10: in-app notifications only, through the
 * `notify(event)` seam). Pure: it takes two consecutive states and returns
 * the toasts the transition earns, so the decisions are testable without a
 * DOM, a clock, or a booted Pixi app — `main.ts` ends in `void boot()`, so
 * logic left inside it cannot be imported by a test at all.
 *
 * Alerts fire on DOWNWARD CROSSINGS only: the point is "this just got
 * worse", not "this is still bad", or every tick would toast.
 *
 * Sulking is read through `isSulking`, never by comparing `activity`. Round
 * 2A made sulking-ness a flag orthogonal to activity so a Pip could nap its
 * way out of a 0-Energy sulk (machine.ts, "Sulking: activity vs. flag"), so
 * a Pip that is Resting-while-still-sulking keeps `activity === Resting`.
 * Comparing activity silently skips exactly the Pip the player most needs
 * to hear about.
 */

import { NEED_IDS } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { isSulking } from "../core/pips/machine";
import type { NotifyEvent } from "../ui/notify";

/** In-app alert threshold (spec §10: "need < 25"). UI copy trigger, not
 * gameplay tuning — the Sulking floor and mood thresholds own gameplay. */
export const NEED_ALERT_BELOW = 25;

export const NEED_ALERT_COPY: Readonly<Record<string, (name: string) => string>> = {
  hunger: (name) => `${name}'s tummy is rumbling…`,
  cleanliness: (name) => `${name} is getting a bit mossy. The bad kind.`,
  happiness: (name) => `${name} could use some fun.`,
  energy: (name) => `${name} is running on fumes.`,
};

/** Minimal state shape these alerts read — keeps the module usable from
 * tests without constructing a whole GameState. */
export interface AlertsStateSlice {
  readonly pips: Readonly<Record<string, PipState | undefined>>;
  readonly rosterOrder: readonly string[];
}

/**
 * Toasts earned by the `prev → next` transition, in roster order (need-low
 * before sulking, per pip). A pip absent from `prev` counts as
 * not-previously-sulking, so a Pip that arrives already sulking is
 * announced rather than silently skipped.
 */
export function collectAlerts(
  prev: AlertsStateSlice,
  next: AlertsStateSlice,
): readonly NotifyEvent[] {
  const alerts: NotifyEvent[] = [];
  for (const id of next.rosterOrder) {
    const before = prev.pips[id];
    const after = next.pips[id];
    if (after === undefined) continue;

    for (const need of NEED_IDS) {
      const was = before?.needs[need] ?? 100;
      const now = after.needs[need];
      if (now < NEED_ALERT_BELOW && was >= NEED_ALERT_BELOW) {
        const copy = NEED_ALERT_COPY[need];
        if (copy !== undefined) {
          alerts.push({ kind: "needLow", message: copy(after.name) });
        }
      }
    }

    const sulkingNow = isSulking(after);
    const sulkingBefore = before !== undefined && isSulking(before);
    if (sulkingNow && !sulkingBefore) {
      alerts.push({
        kind: "sulking",
        message: `${after.name} is sulking. One good care session fixes it.`,
      });
    }
  }
  return alerts;
}

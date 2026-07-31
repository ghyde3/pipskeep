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
import { recipes as contentRecipes } from "../content/recipes";
import { decorations as contentDecorations } from "../content/decorations";

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

// ---------------------------------------------------------------------------
// ROUND 2J FIX STAGE — A CRAFT FINISHED
// ---------------------------------------------------------------------------

/**
 * THE NINTH DEAD FEATURE, CLOSED.
 *
 * `state.lastCraftCompletions` was written by the reducer in three places
 * (the live TICK settle, the CATCHUP pass, and the enqueue/cancel echo)
 * and READ BY NOBODY outside `core/`. A player who staffed a bench, queued
 * a Poultice and came back 75 minutes later was told nothing at all: the
 * jar was in the Satchel if you went and looked, and a bare `+8 XP` chip
 * flew past. Economy-bible §6.3's "A craft finished" row asks for a toast
 * while live, a Doorstep line after an absence, the item in the Satchel
 * and the XP chip — only the last two existed.
 *
 * This is the toast half. The Doorstep half lives in `ui/welcome.ts`'s
 * `awayCraftLine`, fed by `CatchupSummary.crafted`.
 *
 * WHY IT SKIPS A CATCH-UP TRANSITION: the two surfaces must not both fire
 * for the same completions. A CATCHUP dispatch is exactly the transition
 * that replaces `lastCatchup`, so "this pass was a catch-up" is a pure,
 * observable fact about the state pair — no action type needs threading in.
 */
export interface CraftAlertsStateSlice {
  readonly lastCraftCompletions?: readonly { readonly recipeId: string }[];
  readonly lastCatchup: unknown;
}

/** "Craft Table" is the only crafting station today, but the copy reads
 * the RECIPE, which is what the player actually chose. */
function craftedThingName(recipeId: string): string {
  const recipe = (contentRecipes as Readonly<Record<string, { name: string }>>)[recipeId];
  if (recipe !== undefined) return recipe.name;
  const decoration = contentDecorations.find((d) => d.id === recipeId);
  return decoration?.name ?? recipeId;
}

/** "The Craft Table finished: 2 Poultices." / "…: a Poultice and a
 * Lodestone Cairn." — counted, so a queue that emptied all at once reads
 * as one sentence rather than three toasts. */
export function craftCompletionMessage(
  completions: readonly { readonly recipeId: string }[],
): string | null {
  if (completions.length === 0) return null;
  const counts = new Map<string, number>();
  for (const completion of completions) {
    counts.set(completion.recipeId, (counts.get(completion.recipeId) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([recipeId, count]) => {
    const name = craftedThingName(recipeId);
    return count === 1 ? name : `${count} × ${name}`;
  });
  const list =
    parts.length === 1
      ? (parts[0] as string)
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] as string}`;
  return `The Craft Table finished: ${list}.`;
}

/**
 * The toast a live craft completion earns. Empty during a catch-up pass
 * (the Doorstep says it instead) and empty when nothing finished.
 */
export function collectCraftAlerts(
  prev: CraftAlertsStateSlice,
  next: CraftAlertsStateSlice,
): readonly NotifyEvent[] {
  const completions = next.lastCraftCompletions ?? [];
  if (completions.length === 0) return [];
  // Same array reference ⇒ this dispatch did not re-settle crafting; the
  // reducer always writes a FRESH array (`[]` when nothing finished) on
  // every TICK and CATCHUP, so identity is the honest test.
  if (prev.lastCraftCompletions === next.lastCraftCompletions) return [];
  // A catch-up pass belongs to the Doorstep, not to a toast.
  if (prev.lastCatchup !== next.lastCatchup) return [];
  const message = craftCompletionMessage(completions);
  return message === null ? [] : [{ kind: "info", message }];
}

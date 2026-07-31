/**
 * Items Satchel — pure-layer tests (node-style, matching every other UI
 * suite in the repo). Covers the generated effect-line copy (never
 * authored — a tuning rebalance can't leave it stale), every shipped
 * food resolving to a real icon motif, and the empty/give-hint copy.
 */

import { describe, expect, it } from "vitest";
import { foods } from "../content/foods";
import { MOTIF_IDS } from "../content/icons";
import { createNewGame, rootReducer } from "../core/state";
import type { GameState } from "../core/state";
import { foodEffectLine, itemsSheetModel } from "./itemsSheet";

const T0 = 1_000_000;

function stateWith(inventory: Record<string, number> = {}): GameState {
  const fresh = createNewGame(7, T0);
  // DEBUG_GRANT only touches `resources` (wood/fiber/shell/driftwood);
  // foods live in `inventory`, so build it directly off a fresh game.
  return { ...fresh, inventory: { ...fresh.inventory, ...inventory } };
}

describe("foodEffectLine — generated, never authored", () => {
  it("a hunger-only food shows just the hunger line", () => {
    expect(foodEffectLine(foods.berry)).toBe(`+${foods.berry.hungerRestore} Hunger`);
  });

  it("a food with a happiness side effect appends it", () => {
    expect(foodEffectLine(foods.stew)).toBe(
      `+${foods.stew.hungerRestore} Hunger, +${foods.stew.sideEffects?.happiness} Happiness`,
    );
  });

  it("a food with an energy side effect appends it", () => {
    expect(foodEffectLine(foods.toastnut)).toBe(
      `+${foods.toastnut.hungerRestore} Hunger, +${foods.toastnut.sideEffects?.energy} Energy`,
    );
  });

  it("a food with BOTH side effects (Feastpot) lists all three", () => {
    const line = foodEffectLine(foods.feastpot);
    expect(line).toContain(`+${foods.feastpot.hungerRestore} Hunger`);
    expect(line).toContain(`+${foods.feastpot.sideEffects?.happiness} Happiness`);
    expect(line).toContain(`+${foods.feastpot.sideEffects?.energy} Energy`);
  });

  it("every shipped food WITHOUT an override produces a line starting with its hunger restore", () => {
    for (const food of Object.values(foods)) {
      if (food.effectCopy !== undefined) continue;
      expect(foodEffectLine(food)).toMatch(new RegExp(`^\\+${food.hungerRestore} Hunger`));
    }
  });

  // ROUND 2H — the one override, and the reason it exists. The Poultice
  // restores no Hunger, so the generated line advertised the round's only
  // working cure as "+0 Hunger": the worst food in the game, sitting in
  // the satchel of a player watching their Pip's countdown run down. The
  // Satchel is where a frightened player goes looking, so it has to say
  // what the thing is FOR.
  it("the Poultice says what it does, not '+0 Hunger'", () => {
    const line = foodEffectLine(foods.poultice);
    expect(line).not.toMatch(/Hunger/);
    expect(line).toMatch(/cure/i);
  });

  it("no other food overrides the generated line", () => {
    const overridden = Object.values(foods).filter((f) => f.effectCopy !== undefined);
    expect(overridden.map((f) => f.id)).toEqual(["poultice"]);
  });
});

describe("itemsSheetModel — entries, icons, and copy", () => {
  it("an empty satchel reports the warm empty label and no entries", () => {
    // New saves seed 3 Berries (spec §6.3) — zero it explicitly for a
    // truly empty satchel.
    const model = itemsSheetModel(stateWith({ berry: 0 }));
    expect(model.entries).toEqual([]);
    expect(model.emptyLabel).toMatch(/expeditions/i);
  });

  it("lists only items with a positive count, each with a real icon motif and effect line", () => {
    const model = itemsSheetModel(stateWith({ berry: 3, stew: 0, honeydrop: 1 }));
    expect(model.entries.map((e) => e.itemId).sort()).toEqual(["berry", "honeydrop"]);
    for (const entry of model.entries) {
      expect(MOTIF_IDS as readonly string[], entry.itemId).toContain(entry.resolvedIcon.motif);
      expect(entry.effectLine.length).toBeGreaterThan(0);
      expect(entry.isFood).toBe(true);
    }
    expect(model.emptyLabel).toBeNull();
  });

  it("carries the count straight through", () => {
    const model = itemsSheetModel(stateWith({ berry: 5 }));
    expect(model.entries.find((e) => e.itemId === "berry")?.count).toBe(5);
  });

  it("gives the active Pip's remember-hint when there IS an active Pip", () => {
    const state = stateWith({ berry: 1 });
    const model = itemsSheetModel(state);
    const activeName = state.pips[state.activePipId]?.name;
    expect(model.giveHint).toBe(`Give it — ${activeName} will remember this.`);
  });
});

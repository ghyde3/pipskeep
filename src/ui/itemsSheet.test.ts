/**
 * Items Satchel — pure-layer tests (node-style, matching every other UI
 * suite in the repo). Covers the generated effect-line copy (never
 * authored — a tuning rebalance can't leave it stale), every shipped
 * food resolving to a real icon motif, and the empty/give-hint copy.
 */

import { describe, expect, it } from "vitest";
import { foods } from "../content/foods";
import { POULTICE_ITEM_ID } from "../content/ailments";
import { MOTIF_IDS } from "../content/icons";
import { RESOURCE_IDS } from "../core/economy";
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
  it("an empty satchel reports the warm empty label, and holds nothing but the cure's sign", () => {
    // New saves seed 3 Berries (spec §6.3) — zero it explicitly for a
    // truly empty satchel.
    const model = itemsSheetModel(stateWith({ berry: 0 }));
    // ROUND 2J FIX STAGE — the cure row is ALWAYS listed (see
    // `itemsSheetModel`'s own note): its whole job is to be visible at
    // zero, because that is the moment its copy answers a question.
    expect(model.entries.map((e) => e.itemId)).toEqual([POULTICE_ITEM_ID]);
    expect(model.entries[0]?.outOfStock).toBe(true);
    expect(model.entries[0]?.count).toBe(0);
    expect(model.emptyLabel).toMatch(/expeditions/i);
  });

  it("lists items with a positive count (plus the always-listed cure), each with a real icon motif and effect line", () => {
    const model = itemsSheetModel(stateWith({ berry: 3, stew: 0, honeydrop: 1 }));
    expect(model.entries.map((e) => e.itemId).sort()).toEqual(
      ["berry", "honeydrop", POULTICE_ITEM_ID].sort(),
    );
    for (const entry of model.entries) {
      expect(MOTIF_IDS as readonly string[], entry.itemId).toContain(entry.resolvedIcon.motif);
      expect(entry.effectLine.length).toBeGreaterThan(0);
      expect(entry.isFood).toBe(true);
    }
    expect(model.entries.filter((e) => e.outOfStock).map((e) => e.itemId)).toEqual([
      POULTICE_ITEM_ID,
    ]);
    expect(model.emptyLabel).toBeNull();
  });

  /**
   * ⚠️ ROUND 2J FIX STAGE — the condition bug this replaced.
   * `foods.poultice.effectCopy` was updated to "…Out of jars? The Craft
   * Table can make more." — good copy, wrong condition: the card vanished
   * the moment the count hit zero, so the sentence answering "out of
   * jars?" was visible only while you had jars.
   */
  it("the cure's card names the Craft Table, and is present at exactly the moment you have none", () => {
    const empty = itemsSheetModel(stateWith({ berry: 0 }));
    const cure = empty.entries.find((e) => e.itemId === POULTICE_ITEM_ID);
    expect(cure?.effectLine).toMatch(/craft table/i);

    const held = itemsSheetModel(stateWith({ [POULTICE_ITEM_ID]: 2 }));
    const stocked = held.entries.find((e) => e.itemId === POULTICE_ITEM_ID);
    expect(stocked?.count).toBe(2);
    expect(stocked?.outOfStock).toBe(false);
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

/**
 * ROUND 2J — Materials (docs/hud-redesign.md §2.5). Before this round no
 * resource had ANY viewing surface outside a build screen; this is the
 * fix, and it is what makes lodestone (the round's fifth resource) visible
 * on its own terms rather than a bolted-on special case — the suite below
 * is entirely generic over `RESOURCE_IDS`, lodestone included.
 */
describe("itemsSheetModel — materials (the fifth resource's own visibility fix)", () => {
  it("lists every RESOURCE_IDS entry, in order, even at zero", () => {
    const model = itemsSheetModel(stateWith());
    expect(model.materials.map((m) => m.id)).toEqual([...RESOURCE_IDS]);
    for (const material of model.materials) {
      expect(MOTIF_IDS as readonly string[], material.id).toContain(
        material.resolvedIcon.motif,
      );
      expect(material.tint).toMatch(/^#[0-9a-f]{6}$/i);
      expect(material.name.length).toBeGreaterThan(0);
    }
  });

  it("carries each resource's real count straight through — lodestone included", () => {
    const fresh = createNewGame(11, T0);
    const state: GameState = {
      ...fresh,
      resources: { ...fresh.resources, wood: 12, fiber: 4, lodestone: 7 },
    };
    const model = itemsSheetModel(state);
    const byId = Object.fromEntries(model.materials.map((m) => [m.id, m.count]));
    expect(byId.wood).toBe(12);
    expect(byId.fiber).toBe(4);
    expect(byId.lodestone).toBe(7);
    // Untouched resources still appear, at zero — never dropped.
    expect(byId.shell).toBe(0);
    expect(byId.driftwood).toBe(0);
  });

  it("materials are never gated by the emptiness of the food grid", () => {
    // An empty Satchel (berries zeroed) still reports every material —
    // the two sections are independent facts, not one combined emptiness.
    const model = itemsSheetModel(stateWith({ berry: 0 }));
    expect(model.emptyLabel).not.toBeNull();
    expect(model.materials).toHaveLength(RESOURCE_IDS.length);
  });
});

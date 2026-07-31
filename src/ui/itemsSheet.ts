/**
 * Items bottom sheet (spec §10 "Inventory: simple grid sheet"; docs/
 * progression-bible.md's item-info brief extended to the Satchel):
 * every inventory item as a tap-friendly card — an icon (foods carry no
 * `IconSpec` in content, so `ui/icons.ts`'s small `foodIconSpec` map fills
 * the gap), the item's name, and a CONCRETE effect line ("+25 Hunger",
 * "+50 Hunger, +5 Happiness") instead of leaving the player to guess what
 * a Feed/Give actually does. Foods show Feed and Give; non-food items
 * (future loot) offer Give only.
 *
 * Split like buildMode.ts/focusView.ts: `itemsSheetModel` is PURE
 * (node-testable); `createItemsSheet` is the dumb DOM shell reading
 * state and dispatching FEED / GIVE_ITEM, never mutating.
 */

import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { foods } from "../content/foods";
import { POULTICE_ITEM_ID } from "../content/ailments";
import type { FoodDef } from "../content/foods";
import { itemColors, itemFallbackColor } from "../content/palette";
import type { IconSpec } from "../content/icons";
import { RESOURCE_IDS } from "../core/economy";
import { resourceDisplayName } from "./buildMode";
import { foodIconSpec, renderIcon, resourceIconSpec, resourceTint } from "./icons";
import { sound } from "../app/sound";
import "./itemsSheet.css";

/** "Hunger"/"Happiness"/"Energy" — foods never touch Cleanliness, so this
 * is intentionally smaller than `core/pips`'s full `NeedId` set. */
const FOOD_EFFECT_LABELS: Readonly<Record<"hunger" | "happiness" | "energy", string>> = {
  hunger: "Hunger",
  happiness: "Happiness",
  energy: "Energy",
};

/** "+25 Hunger" / "+50 Hunger, +5 Happiness" — GENERATED from the food's
 * own `hungerRestore`/`sideEffects` numbers (spec §5), never authored, so
 * a tuning rebalance can never leave the Satchel's copy stale.
 *
 * ROUND 2H: an item may override this with `effectCopy` when its real
 * effect is not a stat the generator can see. Exactly one does — the
 * Poultice, whose generated line read "+0 Hunger" and so presented the
 * round's only working cure as the worst food in the game. */
export function foodEffectLine(food: FoodDef): string {
  if (food.effectCopy !== undefined) return food.effectCopy;
  const parts = [`+${food.hungerRestore} ${FOOD_EFFECT_LABELS.hunger}`];
  if (food.sideEffects?.happiness !== undefined) {
    parts.push(`+${food.sideEffects.happiness} ${FOOD_EFFECT_LABELS.happiness}`);
  }
  if (food.sideEffects?.energy !== undefined) {
    parts.push(`+${food.sideEffects.energy} ${FOOD_EFFECT_LABELS.energy}`);
  }
  return parts.join(", ");
}

export interface ItemEntryModel {
  readonly itemId: string;
  readonly name: string;
  readonly count: number;
  readonly isFood: boolean;
  readonly resolvedIcon: IconSpec;
  readonly tint: string;
  /** "" for a non-food item (nothing yet ships one, but the model stays
   * honest rather than assuming every inventory item is a food). */
  readonly effectLine: string;
  /**
   * ROUND 2J FIX STAGE — this entry is shown at a count of ZERO, because
   * the sentence on it is the answer to "I have none". Exactly one item
   * qualifies: the cure (see `itemsSheetModel`). Feed/Give are suppressed
   * for an out-of-stock row.
   */
  readonly outOfStock: boolean;
}

/** One row of the Materials section (docs/hud-redesign.md §2.5): a base
 * resource's read-only count. No actions — resources are spent from Build
 * cards and the Keep upgrade card, never given or fed. */
export interface MaterialEntryModel {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly resolvedIcon: IconSpec;
  readonly tint: string;
}

export interface ItemsSheetModel {
  readonly entries: readonly ItemEntryModel[];
  /** Warm empty-satchel copy, or null when there is at least one entry. */
  readonly emptyLabel: string | null;
  /** "Give it — Mosspip will remember this.", or null with no active Pip
   * (spec §4.6: the latest gift picks the evolution variant). */
  readonly giveHint: string | null;
  /**
   * ROUND 2J — every `RESOURCE_IDS` entry (wood/fiber/shell/driftwood/
   * lodestone), ALWAYS shown, zero counts included. Before this round
   * resources had NO viewing surface outside a build screen at all (docs/
   * hud-redesign.md §2.5's own finding); this is the fix, and it is what
   * makes the round's fifth resource (lodestone) visible on its own terms
   * rather than as a special case bolted onto the Satchel. Always-five
   * (never "only the ones you have") because the list is short, fixed and
   * known — unlike the food grid above, seeing "Lodestone 0" is a fact
   * worth having, not clutter.
   */
  readonly materials: readonly MaterialEntryModel[];
}

/**
 * ROUND 2J FIX STAGE — THE CURE IS ALWAYS LISTED, even at zero.
 *
 * Round 2J updated `foods.poultice.effectCopy` to "Give it to an ailing
 * Pip — a real chance to cure them. Out of jars? The Craft Table can make
 * more." Good copy, wrong condition: this model builds its rows from
 * `Object.entries(state.inventory).filter(([, n]) => n > 0)`, so the
 * Poultice card DISAPPEARS the moment the count hits zero — and the
 * sentence that answers "out of jars?" was visible only while you had
 * jars. Combined with the ailment card (fixed separately), there was no
 * surface anywhere in the game naming the Craft Table at the moment a
 * player had an ill Pip and an empty Satchel.
 *
 * One item, not a general "show everything at zero": the Satchel's food
 * grid is browsable and a wall of zeroes is clutter. The cure is the one
 * row whose absence is itself the thing the player needs told.
 */
const ALWAYS_LISTED_ITEM_IDS: readonly string[] = [POULTICE_ITEM_ID];

/** The whole Satchel's view model. Pure. */
export function itemsSheetModel(state: GameState): ItemsSheetModel {
  const held = Object.entries(state.inventory).filter(([, n]) => n > 0);
  const heldIds = new Set(held.map(([itemId]) => itemId));
  const rows: readonly (readonly [string, number])[] = [
    ...held,
    ...ALWAYS_LISTED_ITEM_IDS.filter((id) => !heldIds.has(id)).map(
      (id) => [id, 0] as const,
    ),
  ];
  const entries: ItemEntryModel[] = rows.map(([itemId, count]) => {
    const food = foods[itemId as keyof typeof foods];
    const isFood = food !== undefined;
    return {
      itemId,
      name: food?.name ?? itemId,
      count,
      isFood,
      resolvedIcon: foodIconSpec(itemId),
      tint: itemColors[itemId] ?? itemFallbackColor,
      effectLine: food === undefined ? "" : foodEffectLine(food),
      outOfStock: count <= 0,
    };
  });

  const materials: MaterialEntryModel[] = RESOURCE_IDS.map((id) => ({
    id,
    name: resourceDisplayName(id),
    count: state.resources[id] ?? 0,
    resolvedIcon: resourceIconSpec(id),
    tint: resourceTint(id),
  }));

  const activeName = state.pips[state.activePipId]?.name;
  return {
    entries,
    // The empty-satchel line keys on what you actually HOLD, so the
    // always-listed cure row does not suppress it.
    emptyLabel:
      held.length === 0 ? "Nothing in the satchel — expeditions will fix that soon." : null,
    giveHint: activeName === undefined ? null : `Give it — ${activeName} will remember this.`,
    materials,
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface ItemsSheetDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface ItemsSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

export function createItemsSheet(deps: ItemsSheetDeps): ItemsSheet {
  const el = document.createElement("div");
  el.className = "pk-sheet-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-sheet-backdrop";

  const sheet = document.createElement("div");
  sheet.className = "pk-sheet";

  const handle = document.createElement("div");
  handle.className = "pk-sheet-handle";
  const title = document.createElement("div");
  title.className = "pk-sheet-title";
  title.textContent = "Satchel";
  const grid = document.createElement("div");
  grid.className = "pk-sheet-grid";

  // ROUND 2J — Materials, at the bottom (docs/hud-redesign.md §2.5): a
  // read-only row per base resource. Below the food grid because a food's
  // Feed/Give buttons are the decision a player opens this sheet to make;
  // a resource count is a fact to check, not an action to take.
  const materialsTitle = document.createElement("div");
  materialsTitle.className = "pk-sheet-title pk-materials-title";
  materialsTitle.textContent = "Materials";
  const materialsList = document.createElement("div");
  materialsList.className = "pk-materials-list";

  sheet.append(handle, title, grid, materialsTitle, materialsList);
  el.append(backdrop, sheet);

  let isOpen = false;
  let lastState: GameState | null = null;

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-sheet-wrap--open");
  };
  backdrop.addEventListener("click", close);

  const rebuild = (state: GameState): void => {
    const model = itemsSheetModel(state);
    grid.replaceChildren();
    materialsList.replaceChildren();

    if (model.emptyLabel !== null) {
      const empty = document.createElement("div");
      empty.className = "pk-sheet-empty";
      empty.textContent = model.emptyLabel;
      grid.appendChild(empty);
    } else {
      buildFoodGrid(model);
    }

    for (const material of model.materials) {
      const row = document.createElement("div");
      row.className = "pk-materials-row";
      row.appendChild(renderIcon(material.resolvedIcon, material.tint, "sm"));
      const name = document.createElement("div");
      name.className = "pk-materials-name";
      name.textContent = material.name;
      const count = document.createElement("div");
      count.className = "pk-materials-count";
      count.textContent = String(material.count);
      row.append(name, count);
      materialsList.appendChild(row);
    }
  };

  /** The food grid — split out so `rebuild`'s early-empty branch above can
   * skip it while the Materials section below still always renders (a
   * resource count is a fact worth having even with an empty Satchel). */
  function buildFoodGrid(model: ItemsSheetModel): void {
    for (const entry of model.entries) {
      const card = document.createElement("div");
      card.className = "pk-item";

      const head = document.createElement("div");
      head.className = "pk-satchel-head";
      head.appendChild(renderIcon(entry.resolvedIcon, entry.tint, "md"));
      const name = document.createElement("div");
      name.className = "pk-item-name";
      name.textContent = entry.name;
      head.appendChild(name);
      card.appendChild(head);

      if (entry.effectLine !== "") {
        const effect = document.createElement("div");
        effect.className = "pk-satchel-effect";
        effect.textContent = entry.effectLine;
        card.appendChild(effect);
      }

      const countEl = document.createElement("div");
      countEl.className = "pk-item-count";
      countEl.textContent = `×${entry.count}`;
      card.appendChild(countEl);

      // ROUND 2J FIX STAGE — an out-of-stock row (only ever the cure) is
      // a SIGN, not a control: it carries the "the Craft Table can make
      // more" sentence and no buttons to press.
      if (entry.outOfStock) {
        card.classList.add("pk-item--empty");
        grid.appendChild(card);
        continue;
      }

      const actions = document.createElement("div");
      actions.className = "pk-item-actions";
      const act = (label: string, onTap: () => void): void => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pk-item-btn";
        b.textContent = label;
        b.addEventListener("click", () => {
          sound("ui.tap");
          onTap();
          close();
        });
        actions.appendChild(b);
      };
      if (entry.isFood) {
        act("Feed", () => {
          deps.dispatch({
            type: "FEED",
            pipId: deps.getState().activePipId,
            foodId: entry.itemId,
            at: deps.clock.now(),
          });
        });
      }
      act("Give", () => {
        deps.dispatch({
          type: "GIVE_ITEM",
          pipId: deps.getState().activePipId,
          itemId: entry.itemId,
          at: deps.clock.now(),
        });
      });
      card.appendChild(actions);

      // Gifts are remembered (spec §4.6: the latest gift picks the
      // evolution variant) — a soft nudge, no spoilers.
      if (model.giveHint !== null) {
        const hint = document.createElement("div");
        hint.className = "pk-item-hint";
        hint.textContent = model.giveHint;
        card.appendChild(hint);
      }

      grid.appendChild(card);
    }
  }

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      if (lastState !== null) rebuild(lastState);
      el.classList.add("pk-sheet-wrap--open");
    },
    close,
    sync(state: GameState): void {
      lastState = state;
      if (isOpen) rebuild(state);
    },
  };
}

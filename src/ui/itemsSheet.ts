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
import type { FoodDef } from "../content/foods";
import { itemColors, itemFallbackColor } from "../content/palette";
import type { IconSpec } from "../content/icons";
import { foodIconSpec, renderIcon } from "./icons";
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
 * a tuning rebalance can never leave the Satchel's copy stale. */
export function foodEffectLine(food: FoodDef): string {
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
}

export interface ItemsSheetModel {
  readonly entries: readonly ItemEntryModel[];
  /** Warm empty-satchel copy, or null when there is at least one entry. */
  readonly emptyLabel: string | null;
  /** "Give it — Mosspip will remember this.", or null with no active Pip
   * (spec §4.6: the latest gift picks the evolution variant). */
  readonly giveHint: string | null;
}

/** The whole Satchel's view model. Pure. */
export function itemsSheetModel(state: GameState): ItemsSheetModel {
  const rows = Object.entries(state.inventory).filter(([, n]) => n > 0);
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
    };
  });

  const activeName = state.pips[state.activePipId]?.name;
  return {
    entries,
    emptyLabel:
      entries.length === 0 ? "Nothing in the satchel — expeditions will fix that soon." : null,
    giveHint: activeName === undefined ? null : `Give it — ${activeName} will remember this.`,
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
  sheet.append(handle, title, grid);
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

    if (model.emptyLabel !== null) {
      const empty = document.createElement("div");
      empty.className = "pk-sheet-empty";
      empty.textContent = model.emptyLabel;
      grid.appendChild(empty);
      return;
    }

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
  };

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

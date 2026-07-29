/**
 * Items bottom sheet (spec §10 "Inventory: simple grid sheet"): the
 * inventory as a tap-friendly grid — foods show counts with Feed and
 * Give; non-food items (future loot) offer Give only. Dumb DOM: reads
 * state, dispatches FEED / GIVE_ITEM, never mutates.
 */

import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { foods } from "../content/foods";
import { itemColors, itemFallbackColor } from "../content/palette";
import { sound } from "../app/sound";

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
    grid.replaceChildren();
    const entries = Object.entries(state.inventory).filter(([, n]) => n > 0);
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pk-sheet-empty";
      empty.textContent =
        "Nothing in the satchel — expeditions will fix that soon.";
      grid.appendChild(empty);
      return;
    }
    for (const [itemId, count] of entries) {
      const isFood = itemId in foods;
      const card = document.createElement("div");
      card.className = "pk-item";

      const swatch = document.createElement("div");
      swatch.className = "pk-item-swatch";
      swatch.style.background = itemColors[itemId] ?? itemFallbackColor;

      const name = document.createElement("div");
      name.className = "pk-item-name";
      name.textContent = foods[itemId as keyof typeof foods]?.name ?? itemId;

      const countEl = document.createElement("div");
      countEl.className = "pk-item-count";
      countEl.textContent = `×${count}`;

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
      if (isFood) {
        act("Feed", () => {
          deps.dispatch({
            type: "FEED",
            pipId: deps.getState().activePipId,
            foodId: itemId,
            at: deps.clock.now(),
          });
        });
      }
      act("Give", () => {
        deps.dispatch({
          type: "GIVE_ITEM",
          pipId: deps.getState().activePipId,
          itemId,
          at: deps.clock.now(),
        });
      });

      card.append(swatch, name, countEl, actions);

      // Gifts are remembered (spec §4.6: the latest gift picks the
      // evolution variant) — a soft nudge, no spoilers.
      const activeName = state.pips[state.activePipId]?.name;
      if (activeName !== undefined) {
        const hint = document.createElement("div");
        hint.className = "pk-item-hint";
        hint.textContent = `Give it — ${activeName} will remember this.`;
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

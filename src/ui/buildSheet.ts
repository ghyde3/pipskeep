/**
 * Build bottom sheet (spec §9 placement UI, §6.3 costs): every placeable
 * and decoration as a tap card — affordable entries are live, short ones
 * grey out with the friendly missing-amounts line (buildMode.ts owns the
 * model). Tapping a live card hands off to placement mode (the render
 * hooks, via the controller in phase5.ts). Below the catalog, the
 * REARRANGE rows: every current placement with thumb-friendly Move /
 * Tuck away buttons (the select-then-move pattern — no fiddly
 * tap-and-hold needed).
 */

import type { GameState } from "../core/state";
import { buildSheetModel } from "./buildMode";
import type { PlacementId } from "../core/keep";
import { sound } from "../app/sound";

export interface BuildSheetDeps {
  getState(): GameState;
  /** Start placing this catalog item (closes the sheet first). */
  startPlace(itemId: string): void;
  /** Start moving this placement (closes the sheet first). */
  startMove(placementId: PlacementId): void;
  /** Remove this placement (sheet stays open and re-syncs). */
  remove(placementId: PlacementId): void;
  /**
   * Fired whenever the sheet opens or closes. The keep bar lives inside
   * `.pk-phase5`, which is its own stacking context, so it cannot be
   * z-index'd under this sheet — the caller hides it instead (same
   * mechanism placement mode already uses).
   */
  onOpenChange?(open: boolean): void;
}

export interface BuildSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

export function createBuildSheet(deps: BuildSheetDeps): BuildSheet {
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
  title.textContent = "Build";
  const grid = document.createElement("div");
  grid.className = "pk-sheet-grid";
  const rearrangeTitle = document.createElement("div");
  rearrangeTitle.className = "pk-sheet-title pk-build-rearrange-title";
  rearrangeTitle.textContent = "Rearrange";
  const rearrangeList = document.createElement("div");
  rearrangeList.className = "pk-build-rearrange";
  sheet.append(handle, title, grid, rearrangeTitle, rearrangeList);
  el.append(backdrop, sheet);

  let isOpen = false;
  let lastState: GameState | null = null;

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-sheet-wrap--open");
    deps.onOpenChange?.(false);
  };
  backdrop.addEventListener("click", close);

  const rebuild = (state: GameState): void => {
    const model = buildSheetModel(state);

    grid.replaceChildren();
    for (const entry of model.entries) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = entry.affordable
        ? "pk-item pk-build-card"
        : "pk-item pk-build-card pk-build-card--short";
      card.disabled = !entry.affordable;

      const name = document.createElement("div");
      name.className = "pk-item-name";
      name.textContent = entry.name;

      const foot = document.createElement("div");
      foot.className = "pk-build-foot";
      foot.textContent =
        entry.kind === "station"
          ? `${entry.footprintLabel} · the Pips will use this`
          : `${entry.footprintLabel} · just lovely`;

      const cost = document.createElement("div");
      cost.className = "pk-build-cost";
      cost.textContent = entry.costLabel;

      card.append(name, foot, cost);

      if (!entry.affordable) {
        const missing = document.createElement("div");
        missing.className = "pk-build-missing";
        missing.textContent = entry.missingLabel;
        card.appendChild(missing);
      }

      card.addEventListener("click", () => {
        if (card.disabled) return;
        sound("ui.tap");
        close();
        deps.startPlace(entry.id);
      });
      grid.appendChild(card);
    }

    rearrangeList.replaceChildren();
    if (model.rearrange.length === 0) {
      rearrangeTitle.style.display = "none";
      return;
    }
    rearrangeTitle.style.display = "";
    for (const row of model.rearrange) {
      const rowEl = document.createElement("div");
      rowEl.className = "pk-build-row";

      const label = document.createElement("div");
      label.className = "pk-build-row-name";
      label.textContent = row.name;
      const where = document.createElement("div");
      where.className = "pk-build-row-where";
      where.textContent =
        row.workerName !== null
          ? `Tile ${row.x + 1}, ${row.y + 1} — ${row.workerName} works here`
          : `Tile ${row.x + 1}, ${row.y + 1}`;
      const text = document.createElement("div");
      text.className = "pk-build-row-text";
      text.append(label, where);

      const move = document.createElement("button");
      move.type = "button";
      move.className = "pk-item-btn";
      move.textContent = "Move";
      move.addEventListener("click", () => {
        sound("ui.tap");
        close();
        deps.startMove(row.placementId);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pk-item-btn pk-build-remove";
      remove.textContent = "Tuck away";
      remove.addEventListener("click", () => {
        sound("ui.tap");
        deps.remove(row.placementId);
      });

      const actions = document.createElement("div");
      actions.className = "pk-item-actions pk-build-row-actions";
      actions.append(move, remove);

      rowEl.append(text, actions);
      rearrangeList.appendChild(rowEl);
    }
  };

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      lastState = deps.getState();
      rebuild(lastState);
      el.classList.add("pk-sheet-wrap--open");
      deps.onOpenChange?.(true);
    },
    close,
    sync(state: GameState): void {
      lastState = state;
      if (isOpen) rebuild(state);
    },
  };
}

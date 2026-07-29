/**
 * Keep level upgrade UI (spec §9 level gates, §6.3 costs, §7.4 roster
 * upgrade): the cozy "Keep Lv N" chip opens a card showing the NEXT
 * level's resource bundle and what it unlocks, with a Purchase button
 * that dispatches PURCHASE_KEEP_LEVEL; the roster upgrade (Cozy Bunks)
 * joins the card once the Keep reaches its prerequisite level.
 *
 * Split like focusView: `buildUpgradeCardModel` is PURE (node-testable);
 * `createUpgradeCard` is the dumb DOM shell. Costs and prerequisites are
 * read from content/keep.ts — no numbers live here (spec §3).
 */

import type { GameAction, GameState } from "../core/state";
import { keepLevels, keepUpgrades, ROSTER_UPGRADE_ID } from "../content/keep";
import { canAfford } from "../core/economy";
import { formatBundle, formatMissing, missingFor } from "./buildMode";
import { sound } from "../app/sound";

/**
 * What each level opens up, as a warm one-liner (spec §15.5). Keyed by
 * the level being BOUGHT. Content lists the mechanical unlocks; this is
 * the player-facing sell.
 */
export const LEVEL_UNLOCK_COPY: Readonly<Record<number, string>> = {
  2: "The Forest trail opens, plus room to build.",
  3: "The Shore opens up, and Cozy Bunks become available.",
};

/** Celebration toasts for the moment a level lands (diffPhase5). */
export const LEVEL_UP_TOASTS: Readonly<Record<number, string>> = {
  2: "The Keep grew! The Forest trail is open, and there's fresh ground to build on.",
  3: "The Keep grew again! The Shore glitters below — and Cozy Bunks are on offer.",
};

/** Fallbacks so an unexpected level never renders blank copy. */
export const LEVEL_UNLOCK_FALLBACK = "New ground, new possibilities.";
export const LEVEL_UP_TOAST_FALLBACK = "The Keep grew!";

export const ROSTER_UPGRADE_TOAST =
  "Cozy Bunks built — the Keep now sleeps five happy Pips.";

export interface NextLevelModel {
  readonly level: number;
  readonly costLabel: string;
  readonly unlockCopy: string;
  readonly affordable: boolean;
  /** Friendly shortfall line, "" when affordable. */
  readonly missingLabel: string;
}

export interface RosterUpgradeModel {
  /** Shown at all once the Keep meets the prerequisite level (spec §9:
   * "roster upgrade purchasable" is a level-3 unlock). */
  readonly visible: boolean;
  readonly owned: boolean;
  readonly name: string;
  readonly costLabel: string;
  readonly affordable: boolean;
  readonly missingLabel: string;
}

export interface UpgradeCardModel {
  readonly currentLevel: number;
  /** Null at max level — the card celebrates instead of selling. */
  readonly next: NextLevelModel | null;
  readonly roster: RosterUpgradeModel;
  /** Shown when there is nothing left to buy at all. */
  readonly maxedCopy: string;
}

export const MAXED_COPY =
  "The Keep is as grand as it gets (for now). The Pips are impressed.";

/** The whole upgrade card's view model. Pure: state in, model out. */
export function buildUpgradeCardModel(state: GameState): UpgradeCardModel {
  const nextDef = keepLevels.find((def) => def.level === state.keep.level + 1);
  const next: NextLevelModel | null =
    nextDef === undefined
      ? null
      : {
          level: nextDef.level,
          costLabel: formatBundle(nextDef.cost),
          unlockCopy: LEVEL_UNLOCK_COPY[nextDef.level] ?? LEVEL_UNLOCK_FALLBACK,
          affordable: canAfford(state.resources, nextDef.cost),
          missingLabel: canAfford(state.resources, nextDef.cost)
            ? ""
            : formatMissing(missingFor(state.resources, nextDef.cost)),
        };

  const upgrade = keepUpgrades[ROSTER_UPGRADE_ID];
  const roster: RosterUpgradeModel =
    upgrade === undefined
      ? {
          visible: false,
          owned: state.rosterUpgradePurchased,
          name: "",
          costLabel: "",
          affordable: false,
          missingLabel: "",
        }
      : {
          visible:
            state.keep.level >= upgrade.prerequisiteLevel ||
            state.rosterUpgradePurchased,
          owned: state.rosterUpgradePurchased,
          name: upgrade.name,
          costLabel: formatBundle(upgrade.cost),
          affordable: canAfford(state.resources, upgrade.cost),
          missingLabel: canAfford(state.resources, upgrade.cost)
            ? ""
            : formatMissing(missingFor(state.resources, upgrade.cost)),
        };

  return {
    currentLevel: state.keep.level,
    next,
    roster,
    maxedCopy: MAXED_COPY,
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface UpgradeCardDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
}

export interface UpgradeCard {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

export function createUpgradeCard(deps: UpgradeCardDeps): UpgradeCard {
  const el = document.createElement("div");
  el.className = "pk-upcard-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-upcard-backdrop";
  const card = document.createElement("div");
  card.className = "pk-upcard";
  el.append(backdrop, card);

  let isOpen = false;
  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-upcard-wrap--open");
  };
  backdrop.addEventListener("click", close);

  const rebuild = (state: GameState): void => {
    const model = buildUpgradeCardModel(state);
    card.replaceChildren();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-focus-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Back to the Keep";
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });

    const title = document.createElement("div");
    title.className = "pk-upcard-title";
    title.textContent = `The Keep — Level ${model.currentLevel}`;
    card.append(closeBtn, title);

    if (model.next !== null) {
      const next = model.next;
      const section = document.createElement("div");
      section.className = "pk-upcard-section";
      const head = document.createElement("div");
      head.className = "pk-upcard-head";
      head.textContent = `Level ${next.level}`;
      const unlock = document.createElement("div");
      unlock.className = "pk-upcard-unlock";
      unlock.textContent = next.unlockCopy;
      const cost = document.createElement("div");
      cost.className = "pk-upcard-cost";
      cost.textContent = next.costLabel;
      section.append(head, unlock, cost);

      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "pk-upcard-buy";
      buy.textContent = "Grow the Keep";
      buy.disabled = !next.affordable;
      buy.addEventListener("click", () => {
        sound("ui.tap");
        deps.dispatch({ type: "PURCHASE_KEEP_LEVEL" });
      });
      section.appendChild(buy);
      if (!next.affordable && next.missingLabel !== "") {
        const missing = document.createElement("div");
        missing.className = "pk-upcard-missing";
        missing.textContent = `${next.missingLabel} — expeditions will get you there.`;
        section.appendChild(missing);
      }
      card.appendChild(section);
    } else if (!model.roster.visible || model.roster.owned) {
      const maxed = document.createElement("div");
      maxed.className = "pk-upcard-maxed";
      maxed.textContent = model.maxedCopy;
      card.appendChild(maxed);
    }

    if (model.roster.visible) {
      const section = document.createElement("div");
      section.className = "pk-upcard-section";
      const head = document.createElement("div");
      head.className = "pk-upcard-head";
      head.textContent = model.roster.name;
      const unlock = document.createElement("div");
      unlock.className = "pk-upcard-unlock";
      unlock.textContent = model.roster.owned
        ? "Built and cozy — the Keep sleeps five Pips now."
        : "Two more beds — room for five Pips in the Keep.";
      section.append(head, unlock);

      if (!model.roster.owned) {
        const cost = document.createElement("div");
        cost.className = "pk-upcard-cost";
        cost.textContent = model.roster.costLabel;
        section.appendChild(cost);
        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = "pk-upcard-buy";
        buy.textContent = "Build the Bunks";
        buy.disabled = !model.roster.affordable;
        buy.addEventListener("click", () => {
          sound("ui.tap");
          deps.dispatch({ type: "PURCHASE_ROSTER_UPGRADE" });
        });
        section.appendChild(buy);
        if (!model.roster.affordable && model.roster.missingLabel !== "") {
          const missing = document.createElement("div");
          missing.className = "pk-upcard-missing";
          missing.textContent = `${model.roster.missingLabel} — the Shore has what you need.`;
          section.appendChild(missing);
        }
      }
      card.appendChild(section);
    }
  };

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      rebuild(deps.getState());
      el.classList.add("pk-upcard-wrap--open");
    },
    close,
    sync(state: GameState): void {
      if (isOpen) rebuild(state);
    },
  };
}

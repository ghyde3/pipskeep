/**
 * ui/ (spec §2): the DOM overlay — top bar, bottom action bar, items
 * sheet, speech bubble, toast stack. Dispatches actions, never mutates
 * state directly (spec §2 rule 4); all reads are `sync(state)` pushes
 * from the store subscription in app/main.ts.
 */

import "./ui.css";
import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import type { CareOutcome } from "../core/pips/care";
import { createTopBar } from "./topBar";
import { createActionBar } from "./actionBar";
import { createItemsSheet } from "./itemsSheet";
import { createSpeechBubble } from "./speechBubble";
import { initNotify, notify } from "./notify";

export { notify } from "./notify";
export type { NotifyEvent, NotifyKind } from "./notify";
export { peekDisplayedMood } from "./topBar";

export interface UiDeps {
  readonly mount: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  readonly clock: Clock;
  /** Screen-space anchor above the active Pip's head (from the scene). */
  getBubbleAnchor(): { x: number; y: number };
}

export interface Ui {
  sync(state: GameState): void;
  /** Per-frame: cooldown rings, bubble anchoring. */
  update(): void;
  /** Bubble + structural-block toasts for a fresh CareOutcome. */
  showOutcome(outcome: CareOutcome): void;
}

/** Warm copy for structural blocks (spec §5: the world said no, not the
 * Pip — keep it light, never guilt). */
const BLOCK_TOASTS: Readonly<Record<string, string>> = {
  cooldown: "Still basking in the last one — give it a moment.",
  outOfStock: "The satchel is empty. Expeditions will fix that soon.",
};

export function initUi(deps: UiDeps): Ui {
  const root = document.createElement("div");
  root.id = "ui";
  deps.mount.appendChild(root);

  const topBar = createTopBar();
  const sheet = createItemsSheet({
    dispatch: (a) => deps.store.dispatch(a),
    getState: () => deps.store.getState(),
    clock: deps.clock,
  });
  const actionBar = createActionBar({
    dispatch: (a) => deps.store.dispatch(a),
    getState: () => deps.store.getState(),
    clock: deps.clock,
    openItems: () => sheet.open(),
  });
  const bubble = createSpeechBubble();

  root.append(topBar.el, bubble.el, actionBar.el, sheet.el);
  initNotify(root);

  return {
    sync(state: GameState): void {
      topBar.sync(state);
      actionBar.sync(state);
      sheet.sync(state);
    },

    update(): void {
      actionBar.tick(deps.clock.now());
      bubble.place(deps.getBubbleAnchor());
    },

    showOutcome(outcome: CareOutcome): void {
      if (outcome.line !== undefined) {
        bubble.place(deps.getBubbleAnchor());
        bubble.show(outcome.line, outcome.applied ? "normal" : "refusal");
      } else if (!outcome.applied) {
        const message = BLOCK_TOASTS[outcome.refusalReason ?? ""];
        if (message !== undefined) notify({ kind: "info", message });
      }
    },
  };
}

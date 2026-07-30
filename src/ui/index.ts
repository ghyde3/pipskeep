/**
 * ui/ (spec §2): the DOM overlay — top bar (active Pip selector), Pip
 * focus view, bottom action bar, items sheet, speech bubble, toast
 * stack. Dispatches actions, never mutates state directly (spec §2 rule
 * 4); all reads are `sync(state)` pushes from the store subscription in
 * app/main.ts.
 */

import "./ui.css";
import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import type { CareOutcome } from "../core/pips/care";
import { createTopBar } from "./topBar";
import { createActionBar } from "./actionBar";
import { createItemsSheet } from "./itemsSheet";
import { createFocusView } from "./focusView";
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
  /** Open the loot-reveal moment (the phase4 module — wired by main.ts).
   * The top bar's "!" chip and the return toast both route here. */
  openReveal(): void;
  /**
   * Open the Long Meadow's retire confirmation for a Pip (round 2C —
   * `ui/sanctuary.ts` owns that dialog; main.ts wires it). Optional: when
   * omitted the focus view simply doesn't draw the affordance, which keeps
   * every pre-2C `initUi` caller and test valid.
   */
  openRetireConfirm?(pipId: string): void;
}

export interface Ui {
  sync(state: GameState): void;
  /**
   * Close every surface this module owns (items sheet + focus view).
   *
   * The integrate stage's mutual-exclusion seam: round 2C added three
   * full-screen destinations that are reachable while a sheet is already
   * up, and "two overlays open at once, resolved by z-index luck" is the
   * bug class this round was told not to repeat. main.ts calls this before
   * opening the Album / Long Meadow / Today.
   */
  closeSurfaces(): void;
  /** Per-frame: cooldown rings, bubble anchoring, focus countdowns. */
  update(): void;
  /** Bubble + structural-block toasts for a fresh CareOutcome. */
  showOutcome(outcome: CareOutcome): void;
  /** Open the Pip focus view on the active pip (spec §10 two views). */
  openFocus(): void;
  /** Speak an arbitrary line above the active Pip (the onboarding
   * landing moment, spec §10.1.2 — same bubble, same anchoring). */
  say(line: string): void;
  /**
   * ROUND 2G — append an element as a sibling of the top bar / action bar,
   * inside `#ui`'s own stacking context (so it inherits the same clip,
   * pointer-events and font stack, but nothing about the top bar's own
   * layout). This is where `app/main.ts` appends the Keep strip
   * (`ui/xpBar.ts`'s `.pk-keepstrip`) — that module owns its OWN fixed
   * position now (bottom-anchored, 8px above the action bar), so this seam
   * is just "give me a parent inside `#ui`", not "lay me out for me".
   *
   * (Round 2F's `mountInTopBar` put the bar INSIDE `.pk-topbar` as its last
   * row; round 2G moved the bar to the thumb zone, so the seam moved with
   * it and was renamed to match what it actually does now.)
   */
  mountChrome(el: HTMLElement): void;
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

  const focus = createFocusView({
    dispatch: (a) => deps.store.dispatch(a),
    getState: () => deps.store.getState(),
    clock: deps.clock,
    openRetireConfirm: deps.openRetireConfirm,
  });
  const topBar = createTopBar({
    dispatch: (a) => deps.store.dispatch(a),
    openFocus: () => focus.open(),
    openReveal: () => deps.openReveal(),
  });
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

  root.append(topBar.el, bubble.el, actionBar.el, sheet.el, focus.el);
  initNotify(root);

  return {
    sync(state: GameState): void {
      topBar.sync(state);
      actionBar.sync(state);
      sheet.sync(state);
      focus.sync(state);
    },

    closeSurfaces(): void {
      sheet.close();
      focus.close();
    },

    update(): void {
      actionBar.tick(deps.clock.now());
      bubble.place(deps.getBubbleAnchor());
      focus.tick(deps.clock.now());
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

    openFocus(): void {
      focus.open();
    },

    say(line: string): void {
      bubble.place(deps.getBubbleAnchor());
      bubble.show(line, "normal");
    },

    mountChrome(el: HTMLElement): void {
      root.appendChild(el);
    },
  };
}

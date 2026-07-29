/**
 * Bottom action bar (spec §10): big thumb-friendly Feed / Clean / Play /
 * Pet / Rest / Items buttons with pressed states, disabled looks, and a
 * live countdown ring while Clean/Pet cool down (spec §5: 60s / 30s).
 *
 * Dumb DOM (spec §2 rule 4): reads state, dispatches actions, never
 * mutates. Cooldown progress needs wall time, which comes from the
 * injected Clock via `tick(now)` — no Date.now() here.
 */

import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { PipActivity } from "../core/pips/types";
import { canReceiveCare } from "../core/pips/machine";
import { tuning } from "../content/tuning";
import { FOOD_IDS } from "../content/foods";
import { sound } from "../app/sound";

export interface ActionBarDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
  openItems(): void;
}

export interface ActionBar {
  readonly el: HTMLElement;
  sync(state: GameState): void;
  /** Per-frame: cooldown rings + countdown numbers. */
  tick(now: number): void;
}

type ButtonId = "feed" | "clean" | "play" | "pet" | "rest" | "items";

/** Accessible names for the six care buttons (a11y — spec §10 big
 * thumb-friendly buttons must also read right to assistive tech).
 * Exported for tests. Rest flips to the wake label while Resting. */
export const ACTION_ARIA_LABELS: Readonly<Record<ButtonId, string>> = {
  feed: "Feed this Pip",
  clean: "Clean this Pip",
  play: "Play with this Pip",
  pet: "Pet this Pip",
  rest: "Tuck this Pip in to rest",
  items: "Open the items satchel",
};

export const REST_WAKE_ARIA_LABEL = "Wake this Pip up";

interface ButtonEls {
  button: HTMLButtonElement;
  label: HTMLElement;
  ring: HTMLElement;
  ringText: HTMLElement;
}

/** First food id with stock, in registry order — the Feed button's pick.
 * (The Items sheet offers explicit choices.) */
export function firstStockedFoodId(state: GameState): string | null {
  for (const id of FOOD_IDS) {
    if ((state.inventory[id] ?? 0) > 0) return id;
  }
  return null;
}

export function createActionBar(deps: ActionBarDeps): ActionBar {
  const el = document.createElement("div");
  el.className = "pk-actionbar";

  const buttons = {} as Record<ButtonId, ButtonEls>;

  const make = (id: ButtonId, text: string, onTap: () => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pk-action";
    button.dataset["action"] = id;
    // Explicit accessible name (a11y): without it the cooldown ring's
    // countdown digits pollute the computed name ("12 Clean") and the
    // buttons read as unnamed/garbled to assistive tech.
    button.setAttribute("aria-label", ACTION_ARIA_LABELS[id]);
    const ring = document.createElement("span");
    ring.className = "pk-ring";
    ring.setAttribute("aria-hidden", "true"); // decorative countdown
    const ringText = document.createElement("span");
    ringText.className = "pk-ring-text";
    ring.appendChild(ringText);
    const label = document.createElement("span");
    label.className = "pk-action-label";
    label.textContent = text;
    button.append(ring, label);
    button.addEventListener("click", () => {
      if (button.disabled) return;
      sound("ui.tap");
      onTap();
    });
    buttons[id] = { button, label, ring, ringText };
    el.appendChild(button);
  };

  const at = (): number => deps.clock.now();
  const activePipId = (): string => deps.getState().activePipId;

  make("feed", "Feed", () => {
    const state = deps.getState();
    const foodId = firstStockedFoodId(state);
    if (foodId === null) return;
    deps.dispatch({ type: "FEED", pipId: activePipId(), foodId, at: at() });
  });
  make("clean", "Clean", () => {
    deps.dispatch({ type: "CLEAN", pipId: activePipId(), at: at() });
  });
  make("play", "Play", () => {
    deps.dispatch({ type: "PLAY", pipId: activePipId(), at: at() });
  });
  make("pet", "Pet", () => {
    deps.dispatch({ type: "PET", pipId: activePipId(), at: at() });
  });
  make("rest", "Rest", () => {
    deps.dispatch({ type: "REST_TOGGLE", pipId: activePipId(), at: at() });
  });
  make("items", "Items", () => {
    deps.openItems();
  });

  /** Remaining cooldown ms for an action, 0 when ready. */
  const cooldownLeft = (
    state: GameState,
    action: "clean" | "pet",
    now: number,
  ): number => {
    const lastUsed = state.cooldowns[state.activePipId]?.[action];
    if (lastUsed === undefined) return 0;
    const total =
      action === "clean" ? tuning.care.clean.cooldownMs : tuning.care.pet.cooldownMs;
    return Math.max(0, total - (now - lastUsed));
  };

  const syncCooldownButton = (
    id: "clean" | "pet",
    state: GameState,
    now: number,
    careOk: boolean,
  ): void => {
    const els = buttons[id];
    const left = cooldownLeft(state, id, now);
    const total =
      id === "clean" ? tuning.care.clean.cooldownMs : tuning.care.pet.cooldownMs;
    if (left > 0) {
      els.button.disabled = true;
      els.button.classList.add("pk-action--cooldown");
      const pct = ((total - left) / total) * 360;
      els.ring.style.setProperty("--pk-ring-deg", `${pct}deg`);
      els.ringText.textContent = `${Math.ceil(left / 1000)}`;
    } else {
      els.button.disabled = !careOk;
      els.button.classList.remove("pk-action--cooldown");
      els.ringText.textContent = "";
    }
  };

  let lastState: GameState | null = null;

  const apply = (state: GameState, now: number): void => {
    const pip = state.pips[state.activePipId];
    if (pip === undefined) return;
    const careOk = canReceiveCare(pip);

    buttons.feed.button.disabled = !careOk || firstStockedFoodId(state) === null;
    buttons.play.button.disabled = !careOk;
    buttons.rest.button.disabled = !careOk;
    buttons.items.button.disabled = false;
    const resting = pip.activity === PipActivity.Resting;
    buttons.rest.label.textContent = resting ? "Wake" : "Rest";
    buttons.rest.button.setAttribute(
      "aria-label",
      resting ? REST_WAKE_ARIA_LABEL : ACTION_ARIA_LABELS.rest,
    );
    syncCooldownButton("clean", state, now, careOk);
    syncCooldownButton("pet", state, now, careOk);
  };

  return {
    el,
    sync(state: GameState): void {
      lastState = state;
      apply(state, deps.clock.now());
    },
    tick(now: number): void {
      if (lastState !== null) apply(lastState, now);
    },
  };
}
